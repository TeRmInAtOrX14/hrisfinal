const express = require('express');

const controller = require('../controllers/loan');
const validate = require('../middlewares/validate');
const schemas = require('../schemas');
const { requireAuth, requireRole, requireEmployeeProfile } = require('../middlewares/auth');

const router = express.Router();
const ADMIN = schemas.ADMIN_ROLES;

router.use(requireAuth);

router.get('/', controller.getLoanRequests);
router.post('/', requireEmployeeProfile, validate(schemas.loan.create), controller.createLoanRequest);
router.put(
  '/:id/review',
  requireRole(ADMIN),
  validate(schemas.loan.review),
  controller.reviewLoanRequest
);

module.exports = router;
