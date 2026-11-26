'use strict';

const os = require('node:os');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createMetrics } = require('./metrics');
const { MemoryStore } = require('./store-memory');
const { PostgresStore } = require('./store-postgres');
const { Scheduler } = require('./scheduler');
const { createAlerter } = require('./alerter');
const { createLeaderElector } = require('./leader');
const { createApp } = require('./app');

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const metrics = createMetrics();
  const store = config.databaseUrl
    ? new PostgresStore({ connectionString: config.databaseUrl })
    : new MemoryStore();
  await store.init();
  logger.info('store initialised', { store: store.kind });

  // Seed monitors only if they don't already exist (idempotent across restarts/replicas)
  const existing = new Set((await store.list()).map((m) => `${m.name}|${m.url}`));
  for (const m of config.monitors) {
    if (existing.has(`${m.name}|${m.url}`)) continue;
    await store.add(m);
    logger.info('seeded monitor', { name: m.name, url: m.url });
  }

  const alert = createAlerter({ webhookUrl: config.alertWebhookUrl, logger });
  const scheduler = new Scheduler({
    store, metrics, alert, logger,
    timeoutMs: config.timeoutMs,
    defaultIntervalSec: config.defaultIntervalSec,
  });

  const leader = createLeaderElector({
    store, logger,
    onElected: async () => { metrics.isLeader.set(1); await scheduler.activate(); },
    onLost: () => { metrics.isLeader.set(0); scheduler.deactivate(); },
  });
  await leader.start();

  // Pick up monitors created/deleted via other replicas
  const syncTimer = setInterval(() => {
    scheduler.sync().catch((e) => logger.error('sync failed', { error: e.message }));
  }, config.syncIntervalSec * 1000);
  syncTimer.unref();

  let ready = false;
  let shuttingDown = false;
  const app = createApp({
    store, scheduler, metrics, logger,
    isReady: () => ready && !shuttingDown,
    whoami: () => ({ pod: os.hostname(), leader: leader.isLeader() }),
  });

  const server = app.listen(config.port, () => {
    ready = true;
    logger.info('uptime-monitor listening', { port: config.port, store: store.kind });
  });

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    setTimeout(() => process.exit(1), 10000).unref();
    clearInterval(syncTimer);
    scheduler.deactivate();
    await leader.stop().catch(() => {});
    server.close(async () => {
      await store.close().catch(() => {});
      process.exit(0);
    });
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ level: 'error', msg: 'fatal startup error', error: err.message }) + '\n');
  process.exit(1);
});
