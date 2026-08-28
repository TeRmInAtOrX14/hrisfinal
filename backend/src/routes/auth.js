const express = require('express');
const rateLimit = require('express-rate-limit');

const controller = require('../controllers/auth');
const validate = require('../middlewares/validate');
const schemas = require('../schemas');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

/**
 * Credential endpoints are rate limited per IP. `express-rate-limit` was already
 * a dependency but was never mounted, so login accepted unlimited password
 * guesses at full speed.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many sign-in attempts. Please try again in a few minutes.' },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many token refreshes. Please sign in again.' },
});

router.post('/login', loginLimiter, validate(schemas.auth.login), controller.login);
router.post('/refresh', refreshLimiter, validate(schemas.auth.refresh), controller.refresh);
router.post('/google-login', loginLimiter, validate(schemas.auth.googleLogin), controller.googleLogin);

router.get('/me', requireAuth, controller.me);
router.post(
  '/change-password',
  requireAuth,
  loginLimiter,
  validate(schemas.auth.changePassword),
  controller.changePassword
);
router.post('/logout', requireAuth, controller.logout);

module.exports = router;
