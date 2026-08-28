const express = require('express');

const controller = require('../controllers/attendance');
const validate = require('../middlewares/validate');
const schemas = require('../schemas');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { requireSyncToken } = require('../middlewares/syncAuth');

const router = express.Router();
const ADMIN = schemas.ADMIN_ROLES;

// Machine-to-machine ingestion from the office sync agent. Authenticated by
// x-sync-token, not a user session, so it sits above requireAuth.
router.post(
  '/punches',
  requireSyncToken,
  validate(schemas.attendance.punches),
  controller.receivePunches
);

router.use(requireAuth);

router.get('/', controller.getAttendance);
router.get('/summary', controller.getAttendanceSummary);

router.post('/sync', requireRole(ADMIN), controller.syncAttendance);
router.post(
  '/manual',
  requireRole(ADMIN),
  validate(schemas.attendance.manualPunch),
  controller.manualPunch
);

module.exports = router;
