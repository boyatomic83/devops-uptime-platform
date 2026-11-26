'use strict';

const request = require('supertest');
const { createApp, validateMonitor } = require('../src/app');
const { createMetrics } = require('../src/metrics');
const { MonitorStore } = require('../src/store');
const { Scheduler } = require('../src/scheduler');

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function setup({ checkResult = { up: true, statusCode: 200, latencyMs: 12 } } = {}) {
  const metrics = createMetrics();
  const store = new MonitorStore();
  const alert = jest.fn();
  const check = jest.fn(async () => ({ ...checkResult, checkedAt: new Date().toISOString() }));
  const scheduler = new Scheduler({ store, metrics, alert, logger, timeoutMs: 1000, defaultIntervalSec: 60, check });
  const app = createApp({ store, scheduler, metrics });
  return { app, store, scheduler, alert, check };
}

describe('health endpoints', () => {
  test('GET /healthz', async () => {
    const { app } = setup();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /readyz returns 503 when not ready', async () => {
    const metrics = createMetrics();
    const store = new MonitorStore();
    const app = createApp({ store, scheduler: {}, metrics, isReady: () => false });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
  });

  test('GET /metrics exposes prometheus metrics', async () => {
    const { app } = setup();
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('process_cpu_user_seconds_total');
  });
});

describe('monitors API', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });
  afterEach(() => ctx.scheduler.stopAll());

  test('creates, lists, fetches and deletes a monitor', async () => {
    const created = await request(ctx.app).post('/api/monitors').send({ name: 'Example', url: 'https://example.com', intervalSec: 30 });
    expect(created.status).toBe(201);
    const { id } = created.body;

    await new Promise((r) => setImmediate(r)); // let the initial check finish
    const list = await request(ctx.app).get('/api/monitors');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].status).toBe('up');

    const one = await request(ctx.app).get(`/api/monitors/${id}`);
    expect(one.body.uptimePercent).toBe(100);

    expect((await request(ctx.app).delete(`/api/monitors/${id}`)).status).toBe(204);
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
    expect(res.status).toBe(200);
    expect(res.body.up).toBe(true);
  });

  test('404 for unknown monitor', async () => {
    expect((await request(ctx.app).post('/api/monitors/nope/check')).status).toBe(404);
    expect((await request(ctx.app).delete('/api/monitors/nope')).status).toBe(404);
  });
});

describe('alerting on state change', () => {
  test('alerts when a monitor goes from up to down', async () => {
    const { store, scheduler, alert, check } = setup();
    const m = store.add({ name: 'svc', url: 'http://svc.test' });
    await scheduler.runCheck(m.id); // pending -> up (no alert)
    expect(alert).not.toHaveBeenCalled();
    check.mockResolvedValueOnce({ up: false, statusCode: 500, latencyMs: 5, checkedAt: new Date().toISOString() });
    await scheduler.runCheck(m.id); // up -> down
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0].status).toBe('down');
  });
});

describe('validateMonitor', () => {
  test('interval bounds', () => {
    expect(validateMonitor({ name: 'x', url: 'https://x.com', intervalSec: 1 })).toContain('intervalSec must be an integer 5-3600');
    expect(validateMonitor({ name: 'x', url: 'https://x.com', intervalSec: 10 })).toEqual([]);
  });
});
