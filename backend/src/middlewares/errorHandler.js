const { ZodError } = require('zod');
const config = require('../config/env');

/**
 * Prisma error codes worth translating into something a user can act on.
 * Without this they surface as opaque 500s.
 */
const PRISMA_ERRORS = {
  P2002: (err) => ({
    status: 409,
    message: `That ${(err.meta?.target || ['value']).join(', ')} is already in use.`,
  }),
  P2003: () => ({ status: 409, message: 'This record is still referenced by other data.' }),
  P2025: () => ({ status: 404, message: 'The requested record was not found.' }),
};

const errorHandler = (err, req, res, _next) => {
  // zod v4 puts problems on `.issues`; the old handler read `.errors` and
  // matched on `err.name === 'ZodError'`, so validation failures came back with
  // `details: undefined`.
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  if (err.code && PRISMA_ERRORS[err.code]) {
    const { status, message } = PRISMA_ERRORS[err.code](err);
    return res.status(status).json({ error: message });
  }

  // Multer
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is too large.' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field in upload.' });
  }

  if (err.message?.startsWith('Unsupported file type')) {
    return res.status(415).json({ error: err.message });
  }

  if (err.message?.includes('not allowed by CORS')) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  const status = err.statusCode || err.status || 500;

  // Log the full error server-side; never leak internals to the client on a 500.
  if (status >= 500) {
    console.error('[Error]', req.method, req.originalUrl, '-', err.stack || err.message);
  }

  res.status(status).json({
    error:
      status >= 500 && config.isProduction
        ? 'Something went wrong. Please try again.'
        : err.message || 'Internal Server Error',
  });
};

module.exports = errorHandler;
