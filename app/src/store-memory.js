'use strict';

const { randomUUID } = require('node:crypto');

const HISTORY_LIMIT = 100;
const RECENT = 20;

/**
 * In-memory store. Fine for a single replica / local dev; data is lost on restart.
 * Implements the same async interface as PostgresStore.
 */
class MemoryStore {
  constructor() {
    this.monitors = new Map();
    this.kind = 'memory';
  }

  async init() {}
  async ping() { return true; }
  async close() {}

  #view(m) {
    const up = m.history.filter((h) => h.up).length;
    return {
      id: m.id,
      name: m.name,
      url: m.url,
      intervalSec: m.intervalSec ?? null,
      createdAt: m.createdAt,
      status: m.status,
      lastCheckedAt: m.lastCheckedAt,
      lastLatencyMs: m.lastLatencyMs,
      lastError: m.lastError,
      uptimePercent: m.history.length ? Math.round((up / m.history.length) * 10000) / 100 : null,
      recentChecks: m.history.slice(-RECENT),
    };
  }

  async add({ name, url, intervalSec }) {
    const m = {
      id: randomUUID(), name, url, intervalSec: intervalSec ?? null,
      status: 'pending', lastCheckedAt: null, lastLatencyMs: null, lastError: null,
      history: [], createdAt: new Date().toISOString(),
    };
    this.monitors.set(m.id, m);
    return this.#view(m);
  }

  async get(id) {
    const m = this.monitors.get(id);
    return m ? this.#view(m) : null;
  }

  async list() {
    return [...this.monitors.values()].map((m) => this.#view(m));
  }

  async remove(id) {
    return this.monitors.delete(id);
  }

  async recordResult(id, result) {
    const m = this.monitors.get(id);
    if (!m) return null;
    const previous = m.status;
    m.status = result.up ? 'up' : 'down';
    m.lastCheckedAt = result.checkedAt;
    m.lastLatencyMs = result.latencyMs;
    m.lastError = result.error || null;
    m.history.push({ up: result.up, latencyMs: result.latencyMs, statusCode: result.statusCode, at: result.checkedAt });
    if (m.history.length > HISTORY_LIMIT) m.history.shift();
    return { monitor: this.#view(m), previous, changed: previous !== m.status && previous !== 'pending' };
  }
}

module.exports = { MemoryStore };
