const jwt = require('jsonwebtoken');
const config = require('../config/env');

/**
 * Access tokens carry the role so route guards can read it without a DB hit,
 * but `requireAuth` always re-reads the user, so a role change or deactivation
 * takes effect on the next request rather than at token expiry.
 */
exports.generateTokens = (user) => {
  const payload = { userId: user.id, role: user.role };

  return {
    accessToken: jwt.sign(payload, config.jwt.accessSecret, {
      expiresIn: config.jwt.accessExpires,
    }),
    refreshToken: jwt.sign(payload, config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshExpires,
    }),
  };
};

exports.verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.accessSecret);
  } catch {
    return null;
  }
};

exports.verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.refreshSecret);
  } catch {
    return null;
  }
};
