'use strict';

const { randomUUID } = require('node:crypto');

const HISTORY_LIMIT = 100;

class MonitorStore {
  constructor() {
    this.monitors = new Map();
  }

  add({ name, url, intervalSec }) {
    const id = randomUUID();
    const monitor = {
      id,
      name,
      url,
      intervalSec,
      status: 'pending',
      lastCheckedAt: null,
      lastLatencyMs: null,
      lastError: null,
      history: [],
      createdAt: new Date().toISOString(),
    };
    this.monitors.set(id, monitor);
    return monitor;
  }

  get(id) {
    return this.monitors.get(id);
  }

  list() {
    return [...this.monitors.values()];
  }

  remove(id) {
    return this.monitors.delete(id);
  }

  recordResult(id, result) {
    const m = this.monitors.get(id);
    if (!m) return null;
    const previous = m.status;
    m.status = result.up ? 'up' : 'down';
    m.lastCheckedAt = result.checkedAt;
    m.lastLatencyMs = result.latencyMs;
    m.lastError = result.error || null;
    m.history.push({ up: result.up, latencyMs: result.latencyMs, statusCode: result.statusCode, at: result.checkedAt });
    if (m.history.length > HISTORY_LIMIT) m.history.shift();
    return { monitor: m, previous, changed: previous !== m.status && previous !== 'pending' };
  }

  uptimePercent(id) {
    const m = this.monitors.get(id);
    if (!m || m.history.length === 0) return null;
    const up = m.history.filter((h) => h.up).length;
    return Math.round((up / m.history.length) * 10000) / 100;
  }
}

module.exports = { MonitorStore };
