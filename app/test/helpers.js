'use strict';

const { createMetrics } = require('../src/metrics');
const { Scheduler } = require('../src/scheduler');

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function makeScheduler(store, checkResult = { up: true, statusCode: 200, latencyMs: 12 }) {
  const metrics = createMetrics();
  const alert = jest.fn();
  const check = jest.fn(async () => ({ ...checkResult, checkedAt: new Date().toISOString() }));
  const scheduler = new Scheduler({ store, metrics, alert, logger, timeoutMs: 1000, defaultIntervalSec: 60, check });
  return { metrics, alert, check, scheduler };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

module.exports = { logger, makeScheduler, flush };
