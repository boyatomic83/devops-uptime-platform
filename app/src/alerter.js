'use strict';

/**
 * Builds the message for a monitor state change and sends it to every
 * configured notification channel (see notifiers.js).
 */
function createAlerter({ notifier, logger }) {
  return async function alert(monitor, previous) {
    const emoji = monitor.status === 'up' ? '✅' : '🔴';
    const text = `${emoji} ${monitor.name} is ${monitor.status.toUpperCase()} (was ${previous})\n${monitor.url}` +
      (monitor.lastError ? `\nError: ${monitor.lastError}` : '');
    logger.warn('monitor state changed', { monitor: monitor.name, from: previous, to: monitor.status });
    return notifier.notify(text);
  };
}

module.exports = { createAlerter };
