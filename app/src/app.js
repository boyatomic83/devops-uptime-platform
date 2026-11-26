'use strict';

const path = require('node:path');
const express = require('express');

function validateMonitor(body) {
  const errors = [];
  if (!body || typeof body.name !== 'string' || !body.name.trim()) errors.push('name is required');
  try {
    const u = new URL(body?.url);
    if (!['http:', 'https:'].includes(u.protocol)) errors.push('url must be http(s)');
  } catch {
    errors.push('url must be a valid URL');
  }
  if (body?.intervalSec !== undefined) {
    const n = Number(body.intervalSec);
    if (!Number.isInteger(n) || n < 5 || n > 3600) errors.push('intervalSec must be an integer 5-3600');
  }
  return errors;
}

function serialize(store, m) {
  const { history, ...rest } = m;
  return { ...rest, uptimePercent: store.uptimePercent(m.id), recentChecks: history.slice(-20) };
}

function createApp({ store, scheduler, metrics, isReady = () => true }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  // Request metrics middleware
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
  app.get('/readyz', (_req, res) =>
    isReady() ? res.json({ status: 'ready' }) : res.status(503).json({ status: 'not ready' }));

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metrics.register.contentType);
    res.end(await metrics.register.metrics());
  });

  app.get('/api/monitors', (_req, res) => {
    res.json(store.list().map((m) => serialize(store, m)));
  });

  app.get('/api/monitors/:id', (req, res) => {
    const m = store.get(req.params.id);
    if (!m) return res.status(404).json({ error: 'monitor not found' });
    res.json(serialize(store, m));
  });

  app.post('/api/monitors', (req, res) => {
    const errors = validateMonitor(req.body);
    if (errors.length) return res.status(400).json({ errors });
    const { name, url, intervalSec } = req.body;
    const m = store.add({ name: name.trim(), url, intervalSec: intervalSec && Number(intervalSec) });
    scheduler.start(m.id);
    res.status(201).json(serialize(store, m));
  });

  app.post('/api/monitors/:id/check', async (req, res) => {
    if (!store.get(req.params.id)) return res.status(404).json({ error: 'monitor not found' });
    const result = await scheduler.runCheck(req.params.id);
    res.json(result);
  });

  app.delete('/api/monitors/:id', (req, res) => {
    if (!store.get(req.params.id)) return res.status(404).json({ error: 'monitor not found' });
    scheduler.stop(req.params.id);
    store.remove(req.params.id);
    res.status(204).end();
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ errors: ['invalid JSON'] });
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

module.exports = { createApp, validateMonitor };
