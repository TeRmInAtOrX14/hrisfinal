require('dotenv').config();

const fs = require('fs');
const path = require('path');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config/env');
const prisma = require('./lib/prisma');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// Behind cPanel/Vercel/nginx the client IP arrives in X-Forwarded-For. Without
// this the rate limiters would bucket the entire internet under the proxy's IP.
app.set('trust proxy', 1);

/**
 * Helmet, with an explicit Content-Security-Policy.
 *
 * The default policy had no practical effect while this process only returned
 * JSON. It starts applying the moment Express serves the SPA below, and the
 * defaults (`script-src 'self'`, `connect-src 'self'`, and `default-src 'self'`
 * covering frames) block Google Identity Services outright — the sign-in
 * script, its iframe, and its token exchange. Fonts are fine on the defaults
 * (`style-src` and `font-src` both already allow `https:`).
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", 'https://accounts.google.com'],
        'connect-src': ["'self'", 'https://accounts.google.com'],
        // blob: — payslip PDFs are fetched as blobs and opened in a new tab.
        'frame-src': ["'self'", 'https://accounts.google.com', 'blob:'],
        // https: — Employee.photoUrl is a free-form URL rendered by the org
        // chart, so employee photos may be hosted anywhere. The default
        // ("'self'" and data: only) silently broke them.
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      },
    },
  })
);

/**
 * CORS.
 *
 * Development still allows localhost and RFC1918 origins so the app can be
 * opened from a phone on the office WiFi, but that allowance is now confined to
 * non-production. In production only the configured front-end origins are
 * accepted — previously any `http://192.168.x.x` page could call the API with
 * credentials from anywhere the browser could reach it.
 */
const ALLOWED_ORIGINS = ['https://hris.brandigade.com', config.frontendUrl].filter(Boolean);

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

app.use(
  cors({
    origin(origin, callback) {
      // Non-browser clients (the sync agent, curl, health checks) send no Origin.
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      if (!config.isProduction && LOCAL_ORIGIN.test(origin)) return callback(null, true);

      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(morgan(config.isProduction ? 'combined' : 'dev'));

// Blanket limiter. Auth routes add their own, stricter one.
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
  })
);

// Health check — also verifies the database is actually reachable, so a
// load balancer does not keep routing traffic to an instance that cannot serve.
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'up', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', database: 'down', error: err.message });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/employees', require('./routes/employee'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/requests', require('./routes/request'));
app.use('/api/campaigns', require('./routes/campaign'));
app.use('/api/loans', require('./routes/loan'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/documents', require('./routes/document'));
app.use('/api/system', require('./routes/system'));

app.use('/api', (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

/**
 * Serve the built SPA from this same process.
 *
 * Production is a single origin: cPanel runs one Node app that answers both
 * /api and every page route, so there is no cross-origin hop between the front
 * end and the API. Ordering matters — /api routes, then the /api JSON 404
 * above, then static assets, then the SPA fallback, then the error handler.
 *
 * The build is not present in development (Vite serves it instead), so mount
 * this only when the directory actually exists. Otherwise every unmatched path
 * would try to send an index.html that is not there.
 */
const distPath = path.resolve(__dirname, config.frontendDist || '../../frontend/dist');

if (fs.existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath));

  // The negative lookahead keeps unmatched /api routes on the JSON 404 above
  // rather than handing them index.html.
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.warn(`[Server] No frontend build at ${distPath} — serving the API only.`);
}

app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`HRIS backend listening on port ${config.port} (${process.env.NODE_ENV || 'development'})`);
  console.log(`[Attendance] Office timezone: ${config.attendance.timezone}`);
  console.log('[Biometric] Ingestion endpoint ready at POST /api/attendance/punches');

  if (!config.syncAgentToken) {
    console.warn('[Biometric] SYNC_AGENT_TOKEN is not set — punch ingestion will reject all requests.');
  }

  // The direct TCP pull from the ZKTeco device used to run on a setInterval
  // started here. Passenger idles the process between requests on cPanel, so an
  // in-app timer never fires reliably; it is now driven externally by cron
  // hitting POST /api/system/cron/sync. The office sync-agent pushing to
  // /api/attendance/punches remains the primary ingestion path either way.
  if (process.env.ENABLE_DIRECT_ZK_SYNC === 'true') {
    console.log('[Scheduler] Direct ZKTeco sync enabled — drive it with cron against POST /api/system/cron/sync');
  }
});

/** Close connections cleanly so in-flight payroll writes are not cut off. */
async function shutdown(signal) {
  console.log(`\n[Server] ${signal} received — shutting down.`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled promise rejection:', reason);
});

module.exports = app;
