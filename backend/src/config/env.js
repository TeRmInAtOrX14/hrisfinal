/**
 * Central, validated environment configuration.
 *
 * Secrets used to fall back to hard-coded strings ('fallback_access_secret'),
 * which meant a deploy with an empty JWT_SECRET silently signed tokens with a
 * value published in this repository — anyone could mint an admin token. There
 * are no fallbacks any more: in production the process refuses to start, and in
 * development it starts with a loud warning and a per-boot random secret (so
 * tokens simply do not survive a restart).
 */
const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';

const missing = [];

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    missing.push(name);
    return null;
  }
  return value.trim();
}

function optional(name, fallback = null) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

const jwtSecret = required('JWT_SECRET');
const jwtRefreshSecret = required('JWT_REFRESH_SECRET');
const databaseUrl = required('DATABASE_URL');

if (missing.length > 0) {
  const message =
    `Missing required environment variable(s): ${missing.join(', ')}. ` +
    'Copy backend/.env.example to backend/.env and fill them in.';

  if (isProduction) {
    console.error(`[Config] FATAL: ${message}`);
    process.exit(1);
  }
  console.warn(`[Config] WARNING: ${message}`);
  console.warn('[Config] Using ephemeral random secrets — every restart invalidates all sessions.');
}

if (jwtSecret && jwtSecret === jwtRefreshSecret) {
  const message = 'JWT_SECRET and JWT_REFRESH_SECRET must be different values.';
  if (isProduction) {
    console.error(`[Config] FATAL: ${message}`);
    process.exit(1);
  }
  console.warn(`[Config] WARNING: ${message}`);
}

module.exports = {
  isProduction,
  port: Number(optional('PORT', '4000')),
  frontendUrl: optional('FRONTEND_URL'),

  // Where the built SPA lives, relative to src/ (or absolute). The default
  // matches this repository's layout; cPanel deploys that place dist
  // elsewhere can point at it without a code change.
  frontendDist: optional('FRONTEND_DIST'),

  databaseUrl,

  jwt: {
    accessSecret: jwtSecret || crypto.randomBytes(48).toString('hex'),
    refreshSecret: jwtRefreshSecret || crypto.randomBytes(48).toString('hex'),
    accessExpires: optional('JWT_ACCESS_EXPIRES', '15m'),
    refreshExpires: optional('JWT_REFRESH_EXPIRES', '7d'),
  },

  googleClientId: optional('GOOGLE_CLIENT_ID'),

  supabase: {
    url: optional('SUPABASE_URL'),
    serviceKey: optional('SUPABASE_SERVICE_KEY'),
  },

  syncAgentToken: optional('SYNC_AGENT_TOKEN'),

  attendance: {
    // All attendance dates and late calculations are evaluated in this zone,
    // never the server's. A cloud host in UTC would otherwise mis-date every
    // punch coming from a UTC+5 office.
    timezone: optional('TIMEZONE', 'Asia/Karachi'),
    officeStart: optional('OFFICE_START_TIME', '09:30'),
    officeEnd: optional('OFFICE_END_TIME', '18:30'),
  },

  company: {
    name: optional('COMPANY_NAME', 'Brandigade'),
    address: optional('COMPANY_ADDRESS', 'Karachi, Pakistan'),
  },
};
