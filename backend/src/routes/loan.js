const express = require('express');

const controller = require('../controllers/loan');
const validate = require('../middlewares/validate');
const schemas = require('../schemas');
const { requireAuth, requireRole, requireEmployeeProfile, requirePasswordChanged } = require('../middlewares/auth');

const router = express.Router();
const ADMIN = schemas.ADMIN_ROLES;

// The first-login password change was enforced only by a redirect in the
// SPA, so calling the API directly bypassed it entirely. Every route behind
// auth now refuses until the password has actually been changed; /auth keeps
// its own handling so the change endpoint itself stays reachable.
router.use(requireAuth);
router.use(requirePasswordChanged);

router.get('/', controller.getLoanRequests);
router.post('/', requireEmployeeProfile, validate(schemas.loan.create), controller.createLoanRequest);
router.put(
  '/:id/review',
  requireRole(ADMIN),
  validate(schemas.loan.review),
  controller.reviewLoanRequest
);

module.exports = router;
