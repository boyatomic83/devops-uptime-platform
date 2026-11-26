'use strict';

/**
 * Notification channels. Each one is enabled only when its env vars are set.
 *   Slack/Discord : ALERT_WEBHOOK_URL
 *   Telegram      : TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *   WhatsApp      : WHATSAPP_PHONE + WHATSAPP_CALLMEBOT_APIKEY  (via callmebot.com)
 */
function createNotifier({ config, logger, fetchImpl = globalThis.fetch }) {
  const channels = [];
  const post = (url, body) => fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const ensureOk = async (res) => {
    if (res && res.ok === false) throw new Error(`HTTP ${res.status}`);
  };

  if (config.alertWebhookUrl) {
    // "text" for Slack, "content" for Discord
    channels.push({ name: 'webhook', send: async (text) => ensureOk(await post(config.alertWebhookUrl, { text, content: text })) });
  }

  if (config.telegramBotToken && config.telegramChatId) {
    const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
    channels.push({
      name: 'telegram',
      send: async (text) => ensureOk(await post(url, { chat_id: config.telegramChatId, text, disable_web_page_preview: true })),
    });
  }

  if (config.whatsappPhone && config.whatsappApiKey) {
    channels.push({
      name: 'whatsapp',
      send: async (text) => {
        const qs = new URLSearchParams({ phone: config.whatsappPhone, text, apikey: config.whatsappApiKey });
        await ensureOk(await fetchImpl(`https://api.callmebot.com/whatsapp.php?${qs}`, { signal: AbortSignal.timeout(15000) }));
      },
    });
  }

  return {
    channels: channels.map((c) => c.name),
    /** Send to every configured channel; never throws. Returns {channel: true|false}. */
    async notify(text) {
      const results = {};
      await Promise.all(channels.map(async (c) => {
        try {
          await c.send(text);
          results[c.name] = true;
        } catch (err) {
          results[c.name] = false;
          logger.error('notification failed', { channel: c.name, error: err.message });
        }
      }));
      return results;
    },
  };
}

/** Format an Alertmanager webhook payload into a short human-readable message. */
function formatAlertmanager(payload) {
  const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
  const lines = alerts.slice(0, 10).map((a) => {
    const icon = a.status === 'resolved' ? '✅ RESOLVED' : (a.labels?.severity === 'critical' ? '🔴 FIRING' : '🟠 FIRING');
    const what = a.annotations?.summary || a.labels?.alertname || 'alert';
    const detail = a.annotations?.description ? `\n   ${a.annotations.description}` : '';
    return `${icon}: ${what}${detail}`;
  });
  if (alerts.length > 10) lines.push(`…and ${alerts.length - 10} more`);
  return `[Alertmanager] ${payload?.status === 'resolved' ? 'Resolved' : 'Alert'}\n${lines.join('\n')}`;
}

module.exports = { createNotifier, formatAlertmanager };
