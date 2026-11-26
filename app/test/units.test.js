'use strict';

const { parseMonitors, loadConfig } = require('../src/config');
const { checkUrl } = require('../src/checker');
const { createAlerter } = require('../src/alerter');

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
  test('posts to webhook', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true }));
    const alert = createAlerter({ webhookUrl: 'http://hook', logger, fetchImpl });
    expect(await alert(monitor, 'up')).toBe(true);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.text).toContain('svc* is DOWN');
  });
  test('no webhook configured', async () => {
    expect(await createAlerter({ webhookUrl: '', logger })(monitor, 'up')).toBe(false);
  });
  test('webhook failure is handled', async () => {
    const alert = createAlerter({ webhookUrl: 'http://hook', logger, fetchImpl: async () => { throw new Error('x'); } });
    expect(await alert(monitor, 'up')).toBe(false);
  });
});
