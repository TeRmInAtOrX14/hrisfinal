const express = require('express');

const controller = require('../controllers/request');
const validate = require('../middlewares/validate');
const schemas = require('../schemas');
const { requireAuth, requireRole, requireEmployeeProfile } = require('../middlewares/auth');

const router = express.Router();

/**
 * Only Admin/CEO/COO approve requests.
 *
 * 'Team Lead' used to be in this list, but every review handler then rejected
 * Team Leads with a 403 — so the UI showed leads Approve/Reject buttons that
 * always failed. Leads keep read access to their team's requests; the approval
 * authority sits with admins, matching the enforced behaviour.
 */
const REVIEWERS = schemas.ADMIN_ROLES;

router.use(requireAuth);

for (const [path, kind] of [
  ['leave', 'Leave'],
  ['halfday', 'Halfday'],
  ['wfh', 'Wfh'],
]) {
  router.get(`/${path}`, controller[`get${kind}Requests`]);
  router.get(`/${path}/mine`, requireEmployeeProfile, controller[`getMy${kind}Requests`]);

  router.post(
    `/${path}`,
    requireEmployeeProfile,
    validate(schemas.request[path]),
    controller[`create${kind}Request`]
  );

  router.put(
    `/${path}/:id/review`,
    requireRole(REVIEWERS),
    validate(schemas.request.review),
    controller[`review${kind}Request`]
  );
}

module.exports = router;
