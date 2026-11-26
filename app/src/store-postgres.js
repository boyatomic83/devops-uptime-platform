'use strict';

const { Pool } = require('pg');

const RECENT = 20;
const UPTIME_WINDOW = 100;
const RETENTION_PER_MONITOR = 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS monitors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  url          text NOT NULL,
  interval_sec integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS checks (
  id          bigserial PRIMARY KEY,
  monitor_id  uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  up          boolean NOT NULL,
  status_code integer,
  latency_ms  integer NOT NULL,
  error       text,
  checked_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS checks_monitor_time ON checks (monitor_id, checked_at DESC);
`;

/**
 * Postgres-backed store. Lets several replicas share state; see leader.js for
 * how only one replica runs the checks.
 */
class PostgresStore {
  constructor({ connectionString, pool } = {}) {
    this.pool = pool || new Pool({ connectionString, max: 5 });
    this.kind = 'postgres';
  }

  async init() {
    // Serialize migrations across replicas starting at the same time
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(7400001)');
      await client.query(SCHEMA);
    } finally {
      await client.query('SELECT pg_advisory_unlock(7400001)').catch(() => {});
      client.release();
    }
  }

  async ping() {
    await this.pool.query('SELECT 1');
    return true;
  }

  async close() {
    await this.pool.end();
  }

  async #views(whereSql, params) {
    const { rows } = await this.pool.query(
      `SELECT m.id, m.name, m.url, m.interval_sec, m.created_at,
              COALESCE(c.recent, '[]'::json) AS recent,
              c.uptime
         FROM monitors m
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('up', x.up, 'latencyMs', x.latency_ms, 'statusCode', x.status_code,
                                             'at', x.checked_at, 'error', x.error) ORDER BY x.checked_at) AS recent,
                  (SELECT round(100.0 * avg(CASE WHEN y.up THEN 1 ELSE 0 END), 2)
                     FROM (SELECT up FROM checks WHERE monitor_id = m.id ORDER BY checked_at DESC LIMIT ${UPTIME_WINDOW}) y) AS uptime
             FROM (SELECT * FROM checks WHERE monitor_id = m.id ORDER BY checked_at DESC LIMIT ${RECENT}) x
         ) c ON true
        ${whereSql}
        ORDER BY m.created_at`,
      params,
    );
    return rows.map((r) => {
      const recent = r.recent;
      const last = recent[recent.length - 1];
      return {
        id: r.id,
        name: r.name,
        url: r.url,
        intervalSec: r.interval_sec,
        createdAt: r.created_at.toISOString(),
        status: last ? (last.up ? 'up' : 'down') : 'pending',
        lastCheckedAt: last ? last.at : null,
        lastLatencyMs: last ? last.latencyMs : null,
        lastError: last ? last.error : null,
        uptimePercent: r.uptime === null ? null : Number(r.uptime),
        recentChecks: recent.map(({ error: _error, ...c }) => c), // eslint-disable-line no-unused-vars
      };
    });
  }

  async add({ name, url, intervalSec }) {
    const { rows } = await this.pool.query(
      'INSERT INTO monitors (name, url, interval_sec) VALUES ($1, $2, $3) RETURNING id',
      [name, url, intervalSec ?? null],
    );
    return this.get(rows[0].id);
  }

  async get(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [view] = await this.#views('WHERE m.id = $1', [id]);
    return view || null;
  }

  async list() {
    return this.#views('', []);
  }

  async remove(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    const { rowCount } = await this.pool.query('DELETE FROM monitors WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async recordResult(id, result) {
    const prev = await this.pool.query(
      'SELECT up FROM checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1', [id]);
    const previous = prev.rows.length ? (prev.rows[0].up ? 'up' : 'down') : 'pending';
    try {
      await this.pool.query(
        `INSERT INTO checks (monitor_id, up, status_code, latency_ms, error, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, result.up, result.statusCode, result.latencyMs, result.error || null, result.checkedAt],
      );
    } catch (err) {
      if (err.code === '23503') return null; // monitor deleted mid-check
      throw err;
    }
    // Keep the table bounded
    await this.pool.query(
      `DELETE FROM checks WHERE monitor_id = $1 AND id NOT IN
         (SELECT id FROM checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT ${RETENTION_PER_MONITOR})`,
      [id],
    );
    const monitor = await this.get(id);
    const status = result.up ? 'up' : 'down';
    return { monitor, previous, changed: previous !== status && previous !== 'pending' };
  }
}

module.exports = { PostgresStore, SCHEMA };
