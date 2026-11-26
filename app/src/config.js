'use strict';

/**
 * Parse MONITORS env var: "name=url[|intervalSec],name2=url2"
 */
function parseMonitors(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf('=');
      if (eq === -1) throw new Error(`Invalid MONITORS entry: "${entry}"`);
      const name = entry.slice(0, eq).trim();
      const [url, interval] = entry.slice(eq + 1).split('|');
      return { name, url: url.trim(), intervalSec: interval ? Number(interval) : undefined };
    });
}

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    defaultIntervalSec: Number(env.DEFAULT_INTERVAL_SEC || 30),
    timeoutMs: Number(env.CHECK_TIMEOUT_MS || 5000),
    alertWebhookUrl: env.ALERT_WEBHOOK_URL || '',
    monitors: parseMonitors(env.MONITORS),
    logLevel: env.LOG_LEVEL || 'info',
  };
}

module.exports = { loadConfig, parseMonitors };
