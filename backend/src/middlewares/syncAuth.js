const crypto = require('crypto');
const config = require('../config/env');

/**
 * Authenticate the office-side biometric sync agent.
 *
 * Compared in constant time so the token cannot be recovered a byte at a time by
 * timing repeated requests.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const requireSyncToken = (req, res, next) => {
  const provided = req.headers['x-sync-token'];
  const expected = config.syncAgentToken;

  if (!expected) {
    console.error('[SyncAuth] SYNC_AGENT_TOKEN is not configured — rejecting agent request.');
    return res.status(503).json({ error: 'Biometric ingestion is not configured on this server.' });
  }

  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing sync agent token.' });
  }

  next();
};

module.exports = { requireSyncToken };
