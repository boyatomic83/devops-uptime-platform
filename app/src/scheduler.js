'use strict';

const { checkUrl } = require('./checker');

class Scheduler {
  constructor({ store, metrics, alert, timeoutMs, defaultIntervalSec, logger, check = checkUrl }) {
    Object.assign(this, { store, metrics, alert, timeoutMs, defaultIntervalSec, logger, check });
    this.timers = new Map();
  }

  async runCheck(id) {
    const m = this.store.get(id);
    if (!m) return null;
    const result = await this.check(m.url, { timeoutMs: this.timeoutMs });
    const outcome = this.store.recordResult(id, result);
    if (!outcome) return null; // removed mid-check

    this.metrics.monitorUp.set({ monitor: m.name, url: m.url }, result.up ? 1 : 0);
    this.metrics.checkDuration.observe({ monitor: m.name }, result.latencyMs / 1000);
    this.metrics.checksTotal.inc({ monitor: m.name, result: result.up ? 'up' : 'down' });
    this.logger.debug('check complete', { monitor: m.name, ...result });

    if (outcome.changed) await this.alert(outcome.monitor, outcome.previous);
    return result;
  }

  start(id) {
    const m = this.store.get(id);
    if (!m || this.timers.has(id)) return;
    const intervalMs = (m.intervalSec || this.defaultIntervalSec) * 1000;
    this.runCheck(id).catch((e) => this.logger.error('check failed', { error: e.message }));
    const timer = setInterval(() => {
      this.runCheck(id).catch((e) => this.logger.error('check failed', { error: e.message }));
    }, intervalMs);
    timer.unref();
    this.timers.set(id, timer);
  }

  stop(id) {
    const m = this.store.get(id);
    clearInterval(this.timers.get(id));
    this.timers.delete(id);
    if (m) this.metrics.monitorUp.remove({ monitor: m.name, url: m.url });
  }

  stopAll() {
    for (const id of this.timers.keys()) this.stop(id);
  }
}

module.exports = { Scheduler };
