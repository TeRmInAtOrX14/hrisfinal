const express = require('express');

const controller = require('../controllers/payroll');
const validate = require('../middlewares/validate');
const schemas = require('../schemas');
const { requireAuth, requireRole, requireEmployeeProfile } = require('../middlewares/auth');

const router = express.Router();
const ADMIN = schemas.ADMIN_ROLES;

router.use(requireAuth);

// Self-service
router.get('/my-payslips', requireEmployeeProfile, controller.getMyPayslips);
// RBAC lives in the handler: admins may fetch anyone's, staff only their own.
router.get('/payslips/:id/pdf', controller.getPayslipPdfFile);

// Admin
router.get('/runs', requireRole(ADMIN), controller.getPayrollRuns);
router.get('/runs/:runId/payslips', requireRole(ADMIN), controller.getPayslipsByRun);
router.post('/run', requireRole(ADMIN), validate(schemas.payroll.run), controller.runPayroll);
router.put('/runs/:id/finalize', requireRole(ADMIN), controller.finalizePayroll);
router.post(
  '/generate-manual-pdf',
  requireRole(ADMIN),
  validate(schemas.payroll.manualPdf),
  controller.generateManualPdf
);

module.exports = router;
