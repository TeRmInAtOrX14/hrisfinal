const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendance');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { requireSyncToken } = require('../middlewares/syncAuth');

const adminRoles = ['Admin', 'CEO', 'COO'];

router.post('/punches', requireSyncToken, attendanceController.receivePunches);
router.get('/', requireAuth, attendanceController.getAttendance);
router.get('/summary', requireAuth, attendanceController.getAttendanceSummary);
router.post('/sync', requireAuth, requireRole(adminRoles), attendanceController.syncAttendance);
router.post('/manual', requireAuth, requireRole(adminRoles), attendanceController.manualPunch);

module.exports = router;
