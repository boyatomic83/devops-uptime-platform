'use strict';

/**
 * Sends Slack/Discord-compatible webhook notifications on state changes.
 */
function createAlerter({ webhookUrl, logger, fetchImpl = globalThis.fetch }) {
  return async function alert(monitor, previous) {
    const emoji = monitor.status === 'up' ? '✅' : '🔴';
    const text = `${emoji} *${monitor.name}* is ${monitor.status.toUpperCase()} (was ${previous}) — ${monitor.url}` +
      (monitor.lastError ? `\nError: ${monitor.lastError}` : '');
    logger.warn('monitor state changed', { monitor: monitor.name, from: previous, to: monitor.status });
    if (!webhookUrl) return false;
    try {
      // "text" for Slack, "content" for Discord
      await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(5000),
      });
      return true;
    } catch (err) {
      logger.error('failed to send alert', { error: err.message });
      return false;
    }
  };
}

module.exports = { createAlerter };
