const requireSyncToken = (req, res, next) => {
  const syncTokenHeader = req.headers['x-sync-token'];
  const expectedToken = process.env.SYNC_AGENT_TOKEN;

  if (!expectedToken) {
    return res.status(500).json({ error: 'Server configuration error: SYNC_AGENT_TOKEN is not configured.' });
  }

  if (!syncTokenHeader || syncTokenHeader !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing sync agent token.' });
  }

  next();
};

module.exports = { requireSyncToken };
