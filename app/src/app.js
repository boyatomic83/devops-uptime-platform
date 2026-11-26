'use strict';

const path = require('node:path');
const express = require('express');

function validateMonitor(body) {
  const errors = [];
  if (!body || typeof body.name !== 'string' || !body.name.trim()) errors.push('name is required');
  else if (body.name.length > 100) errors.push('name must be at most 100 characters');
  try {
    const u = new URL(body?.url);
    if (!['http:', 'https:'].includes(u.protocol)) errors.push('url must be http(s)');
  } catch {
    errors.push('url must be a valid URL');
  }
  if (body?.intervalSec !== undefined && body?.intervalSec !== null) {
    const n = Number(body.intervalSec);
    if (!Number.isInteger(n) || n < 5 || n > 3600) errors.push('intervalSec must be an integer 5-3600');
  }
  return errors;
}

// Express 4 does not forward rejected promises to the error handler
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp({ store, scheduler, metrics, logger, isReady = () => true, whoami = () => ({}) }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.use((req, res, next) => {
    const end = metrics.httpRequests.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ? req.baseUrl + req.route.path : 'unmatched';
      end({ method: req.method, route, status: res.statusCode });
    });
    next();
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

  app.get('/readyz', wrap(async (_req, res) => {
    if (!isReady()) return res.status(503).json({ status: 'not ready' });
    try {
      await store.ping();
      res.json({ status: 'ready', store: store.kind });
    } catch {
      res.status(503).json({ status: 'not ready', reason: 'store unavailable' });
    }
  }));

  app.get('/api/whoami', (_req, res) => res.json({ store: store.kind, ...whoami() }));

  app.get('/metrics', wrap(async (_req, res) => {
    res.set('Content-Type', metrics.register.contentType);
    res.end(await metrics.register.metrics());
  }));

  app.get('/api/monitors', wrap(async (_req, res) => {
    res.json(await store.list());
  }));

  app.get('/api/monitors/:id', wrap(async (req, res) => {
    const m = await store.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'monitor not found' });
    res.json(m);
  }));

  app.post('/api/monitors', wrap(async (req, res) => {
    const errors = validateMonitor(req.body);
    if (errors.length) return res.status(400).json({ errors });
    const { name, url, intervalSec } = req.body;
    const m = await store.add({ name: name.trim(), url, intervalSec: intervalSec ? Number(intervalSec) : null });
    await scheduler.sync();
    res.status(201).json(m);
  }));

  app.post('/api/monitors/:id/check', wrap(async (req, res) => {
    if (!(await store.get(req.params.id))) return res.status(404).json({ error: 'monitor not found' });
    res.json(await scheduler.runCheck(req.params.id));
  }));

  app.delete('/api/monitors/:id', wrap(async (req, res) => {
    if (!(await store.remove(req.params.id))) return res.status(404).json({ error: 'monitor not found' });
    scheduler.stop(req.params.id);
    res.status(204).end();
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ errors: ['invalid JSON'] });
    logger?.error('request failed', { error: err.message });
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

module.exports = { createApp, validateMonitor };
