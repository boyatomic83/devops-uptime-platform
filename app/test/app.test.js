'use strict';

const request = require('supertest');
const { createApp, validateMonitor } = require('../src/app');
const { createMetrics } = require('../src/metrics');
const { MemoryStore } = require('../src/store-memory');
const { logger, makeScheduler, flush } = require('./helpers');

async function setup(opts) {
  const store = new MemoryStore();
  const ctx = makeScheduler(store, opts);
  await ctx.scheduler.activate();
  const app = createApp({ store, scheduler: ctx.scheduler, metrics: ctx.metrics, logger, whoami: () => ({ leader: true }) });
  return { app, store, ...ctx };
}

describe('health endpoints', () => {
  test('GET /healthz', async () => {
    const { app } = await setup();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
  });

  test('GET /readyz reports store', async () => {
    const { app } = await setup();
    const res = await request(app).get('/readyz');
    expect(res.body).toEqual({ status: 'ready', store: 'memory' });
  });

  test('GET /readyz returns 503 when not ready', async () => {
    const app = createApp({ store: new MemoryStore(), scheduler: {}, metrics: createMetrics(), isReady: () => false });
    expect((await request(app).get('/readyz')).status).toBe(503);
  });

  test('GET /readyz returns 503 when store is down', async () => {
    const store = new MemoryStore();
    store.ping = async () => { throw new Error('db down'); };
    const app = createApp({ store, scheduler: {}, metrics: createMetrics() });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('store unavailable');
  });

  test('GET /metrics exposes prometheus metrics', async () => {
    const { app } = await setup();
    const res = await request(app).get('/metrics');
    expect(res.text).toContain('process_cpu_user_seconds_total');
    expect(res.text).toContain('uptime_scheduler_leader');
  });

  test('GET /api/whoami', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/whoami')).body).toEqual({ store: 'memory', leader: true });
  });
});

describe('monitors API', () => {
  let ctx;
  beforeEach(async () => { ctx = await setup(); });
  afterEach(() => ctx.scheduler.deactivate());

  test('creates, lists, fetches and deletes a monitor', async () => {
    const created = await request(ctx.app).post('/api/monitors').send({ name: 'Example', url: 'https://example.com', intervalSec: 30 });
    expect(created.status).toBe(201);
    const { id } = created.body;

    await flush(); // let the initial check finish
    const list = await request(ctx.app).get('/api/monitors');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].status).toBe('up');
    expect(ctx.scheduler.jobs.has(id)).toBe(true);

    const one = await request(ctx.app).get(`/api/monitors/${id}`);
    expect(one.body.uptimePercent).toBe(100);

    expect((await request(ctx.app).delete(`/api/monitors/${id}`)).status).toBe(204);
    expect(ctx.scheduler.jobs.has(id)).toBe(false);
    expect((await request(ctx.app).get(`/api/monitors/${id}`)).status).toBe(404);
  });

  test('rejects invalid input', async () => {
    const res = await request(ctx.app).post('/api/monitors').send({ name: '', url: 'ftp://x' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining(['name is required', 'url must be http(s)']));
  });

  test('rejects malformed JSON', async () => {
    const res = await request(ctx.app).post('/api/monitors').set('content-type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
  });

  test('manual check endpoint', async () => {
    const { body } = await request(ctx.app).post('/api/monitors').send({ name: 'A', url: 'http://a.test' });
    const res = await request(ctx.app).post(`/api/monitors/${body.id}/check`);
    expect(res.body.up).toBe(true);
  });

  test('404 for unknown monitor', async () => {
    expect((await request(ctx.app).post('/api/monitors/nope/check')).status).toBe(404);
    expect((await request(ctx.app).delete('/api/monitors/nope')).status).toBe(404);
  });

  test('store errors become 500, not crashes', async () => {
    ctx.store.list = async () => { throw new Error('boom'); };
    expect((await request(ctx.app).get('/api/monitors')).status).toBe(500);
  });
});

describe('scheduler', () => {
  test('alerts when a monitor goes from up to down', async () => {
    const store = new MemoryStore();
    const { scheduler, alert, check } = makeScheduler(store);
    const m = await store.add({ name: 'svc', url: 'http://svc.test' });
    await scheduler.runCheck(m.id); // pending -> up (no alert)
    expect(alert).not.toHaveBeenCalled();
    check.mockResolvedValueOnce({ up: false, statusCode: 500, latencyMs: 5, checkedAt: new Date().toISOString() });
    await scheduler.runCheck(m.id); // up -> down
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0].status).toBe('down');
  });

  test('only runs checks while active (leader) and reconciles with the store', async () => {
    const store = new MemoryStore();
    const { scheduler } = makeScheduler(store);
    const a = await store.add({ name: 'a', url: 'http://a.test' });
    await scheduler.sync();
    expect(scheduler.jobs.size).toBe(0); // not leader yet

    await scheduler.activate();
    expect([...scheduler.jobs.keys()]).toEqual([a.id]);

    await store.remove(a.id); // e.g. deleted via another replica
    const b = await store.add({ name: 'b', url: 'http://b.test' });
    await scheduler.sync();
    expect([...scheduler.jobs.keys()]).toEqual([b.id]);

    scheduler.deactivate();
    expect(scheduler.jobs.size).toBe(0);
  });
});

describe('validateMonitor', () => {
  test('interval bounds', () => {
    expect(validateMonitor({ name: 'x', url: 'https://x.com', intervalSec: 1 })).toContain('intervalSec must be an integer 5-3600');
    expect(validateMonitor({ name: 'x', url: 'https://x.com', intervalSec: 10 })).toEqual([]);
  });
});
