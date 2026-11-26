'use strict';

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createMetrics } = require('./metrics');
const { MonitorStore } = require('./store');
const { Scheduler } = require('./scheduler');
const { createAlerter } = require('./alerter');
const { createApp } = require('./app');

const config = loadConfig();
const logger = createLogger(config.logLevel);
const metrics = createMetrics();
const store = new MonitorStore();
const alert = createAlerter({ webhookUrl: config.alertWebhookUrl, logger });
const scheduler = new Scheduler({
  store, metrics, alert, logger,
  timeoutMs: config.timeoutMs,
  defaultIntervalSec: config.defaultIntervalSec,
});

let ready = false;
let shuttingDown = false;
const app = createApp({ store, scheduler, metrics, isReady: () => ready && !shuttingDown });

for (const m of config.monitors) {
  const created = store.add(m);
  scheduler.start(created.id);
  logger.info('seeded monitor', { name: m.name, url: m.url });
}

const server = app.listen(config.port, () => {
  ready = true;
  logger.info('uptime-monitor listening', { port: config.port });
});

// Graceful shutdown for Kubernetes rolling updates
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  scheduler.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
