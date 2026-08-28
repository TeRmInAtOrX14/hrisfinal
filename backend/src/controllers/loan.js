const prisma = require('../lib/prisma');
const { logAudit } = require('../utils/audit');
const { notifyEmployee, notifyAdmins, reviewOutcome } = require('../utils/notify');
const { isAdmin } = require('../utils/scope');

const EMPLOYEE_SELECT = {
  select: { id: true, fullName: true, employeeCode: true, designation: true },
};

exports.createLoanRequest = async (req, res, next) => {
  try {
    const { type, amount, reason, repaymentMonth, repaymentYear } = req.body;
    const employeeId = req.user.employee.id;

    const request = await prisma.loanRequest.create({
      data: {
        employeeId,
        type,
        amount,
        reason,
        status: 'pending',
        repaymentMonth: repaymentMonth ?? null,
        repaymentYear: repaymentYear ?? null,
      },
    });

    await logAudit(req.user.id, 'SUBMIT_LOAN_REQUEST', 'LoanRequest', request.id, { type, amount });
    await notifyAdmins({
      title: 'New loan / advance request',
      message: `${req.user.employee.fullName} requested ${amount.toLocaleString('en-PK')} (${type.replace('_', ' ')}).`,
      type: 'loan',
      link: '/dashboard/loans',
    });

    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
};

/**
 * Loan requests are personal financial data, so a Team Lead sees only their own
 * — unlike leave, where a lead has legitimate visibility into their team.
 */
exports.getLoanRequests = async (req, res, next) => {
  try {
    const { status, employeeId } = req.query;

    const where = {};
    if (status) where.status = status;

    if (isAdmin(req.user)) {
      if (employeeId) where.employeeId = employeeId;
    } else {
      if (!req.user.employee) {
        return res.status(400).json({ error: 'No employee profile is linked to your account.' });
      }
      where.employeeId = req.user.employee.id;
    }

    const requests = await prisma.loanRequest.findMany({
      where,
      include: { employee: EMPLOYEE_SELECT },
      orderBy: { createdAt: 'desc' },
    });

    res.json(requests);
  } catch (err) {
    next(err);
  }
};

exports.reviewLoanRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, repaymentMonth, repaymentYear } = req.body;

    const request = await prisma.loanRequest.findUnique({ where: { id } });
    if (!request) {
      return res.status(404).json({ error: 'Loan request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(409).json({ error: 'This request has already been reviewed.' });
    }

    const month = repaymentMonth ?? request.repaymentMonth;
    const year = repaymentYear ?? request.repaymentYear;

    // Payroll deducts approved loans by matching repaymentMonth/repaymentYear.
    // Approving without them means the deduction silently never happens.
    if (status === 'approved' && (!month || !year)) {
      return res.status(400).json({
        error: 'A repayment month and year are required to approve a loan, so payroll can deduct it.',
      });
    }

    if (status === 'approved') {
      const finalizedRun = await prisma.payrollRun.findUnique({
        where: { periodMonth_periodYear: { periodMonth: month, periodYear: year } },
      });
      if (finalizedRun?.status === 'finalized') {
        return res.status(409).json({
          error: `Payroll for ${month}/${year} is already finalized, so this repayment would never be deducted. Choose a later period.`,
        });
      }
    }

    const updated = await prisma.loanRequest.update({
      where: { id },
      data: {
        status,
        repaymentMonth: month,
        repaymentYear: year,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
    });

    await logAudit(req.user.id, 'REVIEW_LOAN_REQUEST', 'LoanRequest', id, { status, month, year });
    await notifyEmployee(request.employeeId, reviewOutcome('loan', status));

    res.json(updated);
  } catch (err) {
    next(err);
  }
};
