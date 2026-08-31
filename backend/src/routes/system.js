const express = require('express');

const controller = require('../controllers/system');
const validate = require('../middlewares/validate');
const schemas = require('../schemas');
const { requireAuth, requireRole, requirePasswordChanged } = require('../middlewares/auth');
const { requireSyncToken } = require('../middlewares/syncAuth');

const router = express.Router();
const ADMIN = schemas.ADMIN_ROLES;

// Driven by cPanel cron, not a signed-in user, so it is registered ahead of
// requireAuth and authenticated with the sync-agent token instead.
router.post('/cron/sync', requireSyncToken, controller.runBiometricSync);

// The first-login password change was enforced only by a redirect in the
// SPA, so calling the API directly bypassed it entirely. Every route behind
// auth now refuses until the password has actually been changed; /auth keeps
// its own handling so the change endpoint itself stays reachable.
router.use(requireAuth);
router.use(requirePasswordChanged);

// Notifications
router.get('/notifications', controller.getNotifications);
router.put('/notifications/read-all', controller.markAllAsRead);
router.put('/notifications/:id/read', controller.markAsRead);

// Spiffs — admins award, everyone can read their own.
router.get('/spiffs', controller.getSpiffs);
router.post('/spiffs', requireRole(ADMIN), validate(schemas.spiff.create), controller.createSpiff);

// Audit log
router.get('/audit-logs', requireRole(ADMIN), controller.getAuditLogs);
router.get('/audit-actions', requireRole(ADMIN), controller.getAuditActions);

module.exports = router;
