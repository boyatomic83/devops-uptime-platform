'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// Structured JSON logs (easy to ship to Loki / ELK)
function createLogger(level = 'info') {
  const min = LEVELS[level] ?? LEVELS.info;
  const log = (lvl) => (msg, fields = {}) => {
    if (LEVELS[lvl] < min || process.env.NODE_ENV === 'test') return;
    process.stdout.write(JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...fields }) + '\n');
  };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

module.exports = { createLogger };
