'use strict';

const { checkUrl } = require('./checker');

class Scheduler {
  constructor({ store, metrics, alert, timeoutMs, defaultIntervalSec, logger, check = checkUrl }) {
    Object.assign(this, { store, metrics, alert, timeoutMs, defaultIntervalSec, logger, check });
    this.jobs = new Map(); // id -> { timer, monitor }
    this.active = false;
  }

  async runCheck(id) {
    const m = this.jobs.get(id)?.monitor || (await this.store.get(id));
    if (!m) return null;
    const result = await this.check(m.url, { timeoutMs: this.timeoutMs });
    const outcome = await this.store.recordResult(id, result);
    if (!outcome) return null; // removed mid-check

    this.metrics.monitorUp.set({ monitor: m.name, url: m.url }, result.up ? 1 : 0);
    this.metrics.checkDuration.observe({ monitor: m.name }, result.latencyMs / 1000);
    this.metrics.checksTotal.inc({ monitor: m.name, result: result.up ? 'up' : 'down' });
    this.logger.debug('check complete', { monitor: m.name, ...result });

    if (outcome.changed) await this.alert(outcome.monitor, outcome.previous);
    return result;
  }

  #safeRun(id) {
    this.runCheck(id).catch((e) => this.logger.error('check failed', { error: e.message }));
  }

  start(monitor) {
    if (this.jobs.has(monitor.id)) return;
    const intervalMs = (monitor.intervalSec || this.defaultIntervalSec) * 1000;
    const timer = setInterval(() => this.#safeRun(monitor.id), intervalMs);
    timer.unref();
    this.jobs.set(monitor.id, { timer, monitor });
    this.#safeRun(monitor.id);
  }

  stop(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    clearInterval(job.timer);
    this.jobs.delete(id);
    this.metrics.monitorUp.remove({ monitor: job.monitor.name, url: job.monitor.url });
  }

  stopAll() {
    for (const id of [...this.jobs.keys()]) this.stop(id);
  }

  /** Activate (on becoming leader) and reconcile jobs with the store. */
  async activate() {
    this.active = true;
    await this.sync();
  }

  deactivate() {
    this.active = false;
    this.stopAll();
  }

  /**
   * Reconcile running jobs with the monitors in the store: start new ones,
   * stop deleted ones. Called after API changes and periodically, so the
   * leader picks up monitors created through other replicas.
   */
  async sync() {
    if (!this.active) return;
    const monitors = await this.store.list();
    const ids = new Set(monitors.map((m) => m.id));
    for (const id of this.jobs.keys()) if (!ids.has(id)) this.stop(id);
    for (const m of monitors) this.start(m);
  }
}

module.exports = { Scheduler };
