'use strict';

const client = require('prom-client');

function createMetrics() {
  const register = new client.Registry();
  client.collectDefaultMetrics({ register });

  const monitorUp = new client.Gauge({
    name: 'uptime_monitor_up',
    help: '1 if the target is up, 0 if down',
    labelNames: ['monitor', 'url'],
    registers: [register],
  });
  const checkDuration = new client.Histogram({
    name: 'uptime_check_duration_seconds',
    help: 'Duration of target checks',
    labelNames: ['monitor'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  });
  const checksTotal = new client.Counter({
    name: 'uptime_checks_total',
    help: 'Total checks performed',
    labelNames: ['monitor', 'result'],
    registers: [register],
  });
  const httpRequests = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests served by this app',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [register],
  });

  return { register, monitorUp, checkDuration, checksTotal, httpRequests };
}

module.exports = { createMetrics };
