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
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: env.TELEGRAM_CHAT_ID || '',
    whatsappPhone: env.WHATSAPP_PHONE || '',
    whatsappApiKey: env.WHATSAPP_CALLMEBOT_APIKEY || '',
    // Shared secret Alertmanager must send to POST /api/alerts/alertmanager
    alertmanagerToken: env.ALERTMANAGER_WEBHOOK_TOKEN || '',
    monitors: parseMonitors(env.MONITORS),
    logLevel: env.LOG_LEVEL || 'info',
    databaseUrl: env.DATABASE_URL || '',
    syncIntervalSec: Number(env.SYNC_INTERVAL_SEC || 10),
  };
}

module.exports = { loadConfig, parseMonitors };
