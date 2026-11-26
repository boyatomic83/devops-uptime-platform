'use strict';

/**
 * Integration tests against a real Postgres. Skipped unless TEST_DATABASE_URL is set
 * (CI provides one via a service container).
 */
const { Pool } = require('pg');
const { PostgresStore } = require('../src/store-postgres');
const { createLeaderElector } = require('../src/leader');
const { logger, makeScheduler } = require('./helpers');

const url = process.env.TEST_DATABASE_URL;
const maybe = url ? describe : describe.skip;

maybe('PostgresStore (integration)', () => {
  let store;

  beforeAll(async () => {
    store = new PostgresStore({ connectionString: url });
    await store.init();
  });
  beforeEach(async () => { await store.pool.query('TRUNCATE monitors CASCADE'); });
  afterAll(async () => { await store.close(); });

  test('CRUD and check history', async () => {
    const m = await store.add({ name: 'pg', url: 'https://pg.test', intervalSec: 10 });
    expect(m).toMatchObject({ name: 'pg', status: 'pending', intervalSec: 10, uptimePercent: null });

    const now = Date.now();
    const at = (i) => new Date(now + i * 1000).toISOString();
    let r = await store.recordResult(m.id, { up: true, statusCode: 200, latencyMs: 10, checkedAt: at(0) });
    expect(r).toMatchObject({ previous: 'pending', changed: false });
    r = await store.recordResult(m.id, { up: false, statusCode: null, latencyMs: 5, error: 'timeout', checkedAt: at(1) });
    expect(r).toMatchObject({ previous: 'up', changed: true });
    expect(r.monitor).toMatchObject({ status: 'down', lastError: 'timeout', uptimePercent: 50 });
    expect(r.monitor.recentChecks).toHaveLength(2);

    expect(await store.list()).toHaveLength(1);
    expect(await store.remove(m.id)).toBe(true);
    expect(await store.get(m.id)).toBeNull();
    expect(await store.get('not-a-uuid')).toBeNull();
  });

  test('recordResult on a deleted monitor returns null', async () => {
    const m = await store.add({ name: 'gone', url: 'https://gone.test' });
    await store.remove(m.id);
    expect(await store.recordResult(m.id, { up: true, statusCode: 200, latencyMs: 1, checkedAt: new Date().toISOString() })).toBeNull();
  });

  test('init is idempotent', async () => {
    await expect(store.init()).resolves.toBeUndefined();
  });

  test('only one of two replicas becomes leader; failover on loss', async () => {
    const storeB = new PostgresStore({ connectionString: url });
    const events = [];
    const mk = (name, s) => createLeaderElector({
      store: s, logger, retryMs: 50,
      onElected: async () => events.push(`${name}:elected`),
      onLost: () => events.push(`${name}:lost`),
    });
    const a = mk('a', store);
    const b = mk('b', storeB);
    await a.start();
    await b.start();
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);

    await a.stop(); // leader goes away
    await new Promise((r) => setTimeout(r, 200));
    expect(b.isLeader()).toBe(true);
    expect(events).toEqual(['a:elected', 'b:elected']);
    await b.stop();
    await storeB.close();
  });

  test('scheduler end-to-end with postgres', async () => {
    const { scheduler } = makeScheduler(store);
    const m = await store.add({ name: 'e2e', url: 'https://e2e.test' });
    await scheduler.runCheck(m.id);
    expect((await store.get(m.id)).status).toBe('up');
  });

  test('pool is reachable', async () => {
    const pool = new Pool({ connectionString: url });
    await expect(pool.query('SELECT 1')).resolves.toBeTruthy();
    await pool.end();
  });
});
