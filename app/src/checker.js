'use strict';

/**
 * Perform an HTTP check. A target is "up" when it responds with status < 400 within timeout.
 */
async function checkUrl(url, { timeoutMs = 5000, fetchImpl = globalThis.fetch } = {}) {
  const started = performance.now();
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'uptime-monitor/1.0' },
    });
    const latencyMs = Math.round(performance.now() - started);
    return { up: res.status < 400, statusCode: res.status, latencyMs, checkedAt };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const error = err.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : err.message;
    return { up: false, statusCode: null, latencyMs, checkedAt, error };
  }
}

module.exports = { checkUrl };
