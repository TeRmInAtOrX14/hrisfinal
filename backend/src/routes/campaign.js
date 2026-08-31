const express = require('express');

const controller = require('../controllers/campaign');
const validate = require('../middlewares/validate');
const schemas = require('../schemas');
const { requireAuth, requireRole, requirePasswordChanged } = require('../middlewares/auth');

const router = express.Router();
const ADMIN = schemas.ADMIN_ROLES;

// The first-login password change was enforced only by a redirect in the
// SPA, so calling the API directly bypassed it entirely. Every route behind
// auth now refuses until the password has actually been changed; /auth keeps
// its own handling so the change endpoint itself stays reachable.
router.use(requireAuth);
router.use(requirePasswordChanged);

// --- Commission structures -------------------------------------------------
// '/structures/:id' must be declared before '/:campaignId/structures', or
// Express matches 'structures' as a campaignId.
router.put('/structures/:id', requireRole(ADMIN), validate(schemas.campaign.structure), controller.updateStructure);
router.delete('/structures/:id', requireRole(ADMIN), controller.deleteStructure);
router.post('/structures/:id/activate', requireRole(ADMIN), controller.activateStructure);

router.post(
  '/preview-commission',
  validate(schemas.campaign.previewCommission),
  controller.previewCommission
);

router.post(
  '/performance',
  requireRole(ADMIN),
  validate(schemas.campaign.performance),
  controller.logPerformance
);

// --- Campaigns -------------------------------------------------------------
router.get('/', controller.getCampaigns);
router.post('/', requireRole(ADMIN), validate(schemas.campaign.create), controller.createCampaign);
router.put('/:id', requireRole(ADMIN), validate(schemas.campaign.update), controller.updateCampaign);
router.delete('/:id', requireRole(ADMIN), controller.deleteCampaign);
router.post('/:id/duplicate', requireRole(ADMIN), controller.duplicateCampaign);

// Read access is scoped inside the controller to the caller's own campaigns.
router.get('/:id/dashboard', controller.getCampaignDashboard);
router.get('/:campaignId/structures', controller.getStructures);
router.post(
  '/:campaignId/structures',
  requireRole(ADMIN),
  validate(schemas.campaign.structure),
  controller.createStructure
);

// --- Membership ------------------------------------------------------------
router.post(
  '/:id/members',
  requireRole(ADMIN),
  validate(schemas.campaign.assignMember),
  controller.assignMember
);
router.delete('/:id/members/:employeeId', requireRole(ADMIN), controller.unassignMember);
router.put(
  '/:id/members/:employeeId/status',
  requireRole(ADMIN),
  validate(schemas.campaign.memberStatus),
  controller.toggleMemberStatus
);

module.exports = router;
