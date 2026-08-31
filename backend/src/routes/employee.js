const express = require('express');

const controller = require('../controllers/employee');
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

// Static paths must precede '/:id' or 'teams' and 'org-chart' are swallowed by it.
router.get('/teams', controller.getTeams);
router.get('/org-chart', controller.getOrgChart);

router.get('/', controller.getEmployees);
router.get('/:id', controller.getEmployeeById);

router.post('/', requireRole(ADMIN), validate(schemas.employee.create), controller.createEmployee);
router.put('/:id', validate(schemas.employee.update), controller.updateEmployee);

router.post('/:id/reset-password', requireRole(ADMIN), controller.resetEmployeePassword);
router.post('/:id/terminate', requireRole(ADMIN), controller.terminateEmployee);
router.delete('/:id', requireRole(ADMIN), controller.deleteEmployee);

module.exports = router;
