'use strict';

const { parseMonitors, loadConfig } = require('../src/config');
const { checkUrl } = require('../src/checker');
const { createAlerter } = require('../src/alerter');
const { createNotifier, formatAlertmanager } = require('../src/notifiers');

const logger = { debug() {}, info() {}, warn() {}, error() {} };

describe('config', () => {
  test('parses MONITORS', () => {
    expect(parseMonitors('google=https://google.com|10, gh=https://github.com')).toEqual([
      { name: 'google', url: 'https://google.com', intervalSec: 10 },
      { name: 'gh', url: 'https://github.com', intervalSec: undefined },
    ]);
  });
  test('rejects bad entry', () => {
    expect(() => parseMonitors('nourl')).toThrow();
  });
  test('defaults', () => {
    expect(loadConfig({})).toMatchObject({ port: 3000, defaultIntervalSec: 30, monitors: [] });
  });
});

describe('checkUrl', () => {
  test('up on 2xx', async () => {
    const r = await checkUrl('http://x', { fetchImpl: async () => ({ status: 204 }) });
    expect(r).toMatchObject({ up: true, statusCode: 204 });
  });
  test('down on 5xx', async () => {
    const r = await checkUrl('http://x', { fetchImpl: async () => ({ status: 503 }) });
    expect(r.up).toBe(false);
  });
  test('down on network error', async () => {
    const r = await checkUrl('http://x', { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    expect(r).toMatchObject({ up: false, error: 'ECONNREFUSED' });
  });
});

describe('alerter', () => {
  const monitor = { name: 'svc', url: 'http://svc', status: 'down', lastError: 'boom' };
  test('builds message and notifies', async () => {
    const notify = jest.fn(async () => ({ telegram: true }));
    const alert = createAlerter({ notifier: { notify }, logger });
    expect(await alert(monitor, 'up')).toEqual({ telegram: true });
    expect(notify.mock.calls[0][0]).toContain('svc is DOWN (was up)');
    expect(notify.mock.calls[0][0]).toContain('Error: boom');
  });
});

describe('notifiers', () => {
  const ok = () => jest.fn(async () => ({ ok: true, status: 200 }));

  test('no channels configured', async () => {
    const n = createNotifier({ config: {}, logger });
    expect(n.channels).toEqual([]);
    expect(await n.notify('hi')).toEqual({});
  });

  test('telegram', async () => {
    const fetchImpl = ok();
    const n = createNotifier({ config: { telegramBotToken: 'T0K', telegramChatId: '42' }, logger, fetchImpl });
    expect(n.channels).toEqual(['telegram']);
    expect(await n.notify('hello')).toEqual({ telegram: true });
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botT0K/sendMessage');
    expect(JSON.parse(opts.body)).toMatchObject({ chat_id: '42', text: 'hello' });
  });

  test('whatsapp via callmebot', async () => {
    const fetchImpl = ok();
    const n = createNotifier({ config: { whatsappPhone: '+911234567890', whatsappApiKey: 'K' }, logger, fetchImpl });
    await n.notify('a & b');
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.host).toBe('api.callmebot.com');
    expect(Object.fromEntries(url.searchParams)).toEqual({ phone: '+911234567890', text: 'a & b', apikey: 'K' });
  });

  test('slack/discord webhook', async () => {
    const fetchImpl = ok();
    const n = createNotifier({ config: { alertWebhookUrl: 'http://hook' }, logger, fetchImpl });
    await n.notify('x');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ text: 'x', content: 'x' });
  });

  test('one failing channel does not block the others', async () => {
    const fetchImpl = jest.fn(async (url) => (String(url).includes('telegram') ? { ok: false, status: 401 } : { ok: true }));
    const n = createNotifier({
      config: { telegramBotToken: 't', telegramChatId: '1', alertWebhookUrl: 'http://hook' }, logger, fetchImpl,
    });
    expect(await n.notify('x')).toEqual({ webhook: true, telegram: false });
  });

  test('network error is caught', async () => {
    const n = createNotifier({
      config: { alertWebhookUrl: 'http://hook' }, logger, fetchImpl: async () => { throw new Error('ECONNRESET'); },
    });
    expect(await n.notify('x')).toEqual({ webhook: false });
  });
});

describe('formatAlertmanager', () => {
  test('firing and resolved alerts', () => {
    const text = formatAlertmanager({
      status: 'firing',
      alerts: [
        { status: 'firing', labels: { alertname: 'TargetDown', severity: 'critical' }, annotations: { summary: 'api is down', description: 'http://api failing' } },
        { status: 'resolved', labels: { alertname: 'TargetSlow' }, annotations: {} },
      ],
    });
    expect(text).toContain('🔴 FIRING: api is down');
    expect(text).toContain('http://api failing');
    expect(text).toContain('✅ RESOLVED: TargetSlow');
  });

  test('truncates long batches', () => {
    const alerts = Array.from({ length: 12 }, (_, i) => ({ status: 'firing', labels: { alertname: `A${i}` } }));
    expect(formatAlertmanager({ status: 'firing', alerts })).toContain('…and 2 more');
  });
});
