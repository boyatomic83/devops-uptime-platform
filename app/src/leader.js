'use strict';

const LOCK_KEY = 7400002;

/**
 * Leader election so that with N replicas only one runs the checks
 * (otherwise every target would be checked N times and alert N times).
 *
 * Postgres: a session-level advisory lock held on a dedicated connection.
 * If the leader pod dies, its connection closes, the lock is released and
 * another replica takes over within `retryMs`.
 */
function createLeaderElector({ store, logger, onElected, onLost, retryMs = 5000 }) {
  let isLeader = false;
  let timer = null;
  let client = null;

  async function attempt() {
    try {
      if (!client) {
        client = await store.pool.connect();
        client.on('error', (err) => lose(err));
      }
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
      if (rows[0].ok && !isLeader) {
        isLeader = true;
        logger.info('became leader');
        await onElected();
      }
    } catch (err) {
      lose(err);
    }
  }

  function lose(err) {
    if (client) {
      client.release(true);
      client = null;
    }
    if (isLeader) {
      isLeader = false;
      logger.warn('lost leadership', { error: err?.message });
      onLost();
    }
  }

  return {
    async start() {
      if (store.kind !== 'postgres') {
        isLeader = true; // single in-memory instance is always the leader
        await onElected();
        return;
      }
      await attempt();
      timer = setInterval(attempt, retryMs);
      timer.unref();
    },
    async stop() {
      clearInterval(timer);
      if (client) {
        await client.query('SELECT pg_advisory_unlock_all()').catch(() => {});
        client.release();
        client = null;
      }
      isLeader = false;
    },
    isLeader: () => isLeader,
  };
}

module.exports = { createLeaderElector };
