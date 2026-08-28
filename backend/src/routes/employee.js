const express = require('express');

const controller = require('../controllers/employee');
const validate = require('../middlewares/validate');
const schemas = require('../schemas');
const { requireAuth, requireRole } = require('../middlewares/auth');

const router = express.Router();
const ADMIN = schemas.ADMIN_ROLES;

router.use(requireAuth);

// Static paths must precede '/:id' or 'teams' and 'org-chart' are swallowed by it.
router.get('/teams', controller.getTeams);
router.get('/org-chart', controller.getOrgChart);

router.get('/', controller.getEmployees);
router.get('/:id', controller.getEmployeeById);

router.post('/', requireRole(ADMIN), validate(schemas.employee.create), controller.createEmployee);
router.put('/:id', validate(schemas.employee.update), controller.updateEmployee);

router.post('/:id/terminate', requireRole(ADMIN), controller.terminateEmployee);
router.delete('/:id', requireRole(ADMIN), controller.deleteEmployee);

module.exports = router;
