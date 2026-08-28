const prisma = require('../lib/prisma');
const { logAudit } = require('../utils/audit');
const { notifyEmployee, notifyAdmins, reviewOutcome } = require('../utils/notify');
const { resolveEmployeeFilter } = require('../utils/scope');
const { toDateOnly, datesInRange } = require('../utils/attendanceTime');

/**
 * Leave / half-day / WFH request workflows.
 *
 * The three request types are near-identical, so the list and review flows are
 * expressed once and specialised per type. This replaces roughly 300 lines of
 * copy-pasted handlers whose RBAC branches had drifted apart — the Employee/SDR
 * branch dereferenced `req.user.employee.id` with no null check, so a user with
 * no employee profile got a 500 instead of a 400.
 */

const REQUEST_TYPES = {
  leave: {
    model: 'leaveRequest',
    label: 'Leave request',
    auditPrefix: 'LEAVE_REQUEST',
    attendanceStatus: 'leave',
  },
  halfday: {
    model: 'halfdayRequest',
    label: 'Half-day request',
    auditPrefix: 'HALFDAY_REQUEST',
    attendanceStatus: 'half_day',
  },
  wfh: {
    model: 'wfhRequest',
    label: 'Work-from-home request',
    auditPrefix: 'WFH_REQUEST',
    attendanceStatus: 'wfh',
  },
};

const EMPLOYEE_SELECT = {
  select: { id: true, fullName: true, employeeCode: true, designation: true },
};

/** Overlapping-request guard: staff should not stack two leaves on the same day. */
async function hasOverlap(model, employeeId, start, end, shape) {
  if (shape === 'single') {
    const existing = await prisma[model].findFirst({
      where: { employeeId, date: start, status: { in: ['pending', 'approved'] } },
    });
    return Boolean(existing);
  }

  const existing = await prisma[model].findFirst({
    where: {
      employeeId,
      status: { in: ['pending', 'approved'] },
      startDate: { lte: end },
      endDate: { gte: start },
    },
  });
  return Boolean(existing);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function makeList(kind) {
  const { model } = REQUEST_TYPES[kind];

  return async (req, res, next) => {
    try {
      const { status, employeeId } = req.query;

      const scope = await resolveEmployeeFilter(req.user, employeeId);
      if (!scope.ok) {
        return res.status(scope.status).json({ error: scope.error });
      }

      const where = {};
      if (status) where.status = status;
      if (scope.filter !== undefined) where.employeeId = scope.filter;

      const requests = await prisma[model].findMany({
        where,
        include: { employee: EMPLOYEE_SELECT },
        orderBy: { createdAt: 'desc' },
      });

      res.json(requests);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * "My requests" — always scoped to the caller regardless of role.
 *
 * The UI has a "My Requests Log" tab, but it called the same unfiltered list
 * endpoint, so an admin's personal tab showed every request in the company.
 */
function makeMine(kind) {
  const { model } = REQUEST_TYPES[kind];

  return async (req, res, next) => {
    try {
      const requests = await prisma[model].findMany({
        where: { employeeId: req.user.employee.id },
        orderBy: { createdAt: 'desc' },
      });
      res.json(requests);
    } catch (err) {
      next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// Review (approve / reject)
// ---------------------------------------------------------------------------

function makeReview(kind) {
  const { model, label, auditPrefix, attendanceStatus } = REQUEST_TYPES[kind];

  return async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status, reviewNote } = req.body;

      const request = await prisma[model].findUnique({
        where: { id },
        include: { employee: { select: { id: true, fullName: true } } },
      });

      if (!request) {
        return res.status(404).json({ error: `${label} not found` });
      }

      if (request.status !== 'pending') {
        return res.status(409).json({ error: 'This request has already been reviewed.' });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx[model].update({
          where: { id },
          data: { status, reviewedById: req.user.id, reviewedAt: new Date() },
        });

        if (status === 'approved') {
          const dates =
            kind === 'halfday' ? [request.date] : datesInRange(request.startDate, request.endDate);

          const note = reviewNote ? `${label} approved: ${reviewNote}` : `${label} approved`;

          for (const date of dates) {
            await tx.attendance.upsert({
              where: { employeeId_date: { employeeId: request.employeeId, date } },
              create: {
                employeeId: request.employeeId,
                date,
                status: attendanceStatus,
                late: 0,
                earlyDeparture: 0,
                overtime: 0,
                note,
              },
              // A half-day keeps whatever the device recorded; leave and WFH days
              // clear the late penalty, since the employee is not expected in the
              // office at the usual time.
              update:
                kind === 'halfday'
                  ? { status: attendanceStatus, note }
                  : { status: attendanceStatus, late: 0, earlyDeparture: 0, overtime: 0, note },
            });
          }
        }

        return row;
      });

      await logAudit(req.user.id, `REVIEW_${auditPrefix}`, model, id, {
        status,
        employeeId: request.employeeId,
      });

      await notifyEmployee(request.employeeId, reviewOutcome(kind, status, reviewNote));

      res.json(updated);
    } catch (err) {
      next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

exports.createLeaveRequest = async (req, res, next) => {
  try {
    const { type, startDate, endDate, reason } = req.body;
    const employeeId = req.user.employee.id;

    const start = toDateOnly(startDate);
    const end = toDateOnly(endDate);

    if (await hasOverlap('leaveRequest', employeeId, start, end, 'range')) {
      return res.status(409).json({
        error: 'You already have a pending or approved leave request covering these dates.',
      });
    }

    // Inclusive day count. The old version divided the absolute millisecond
    // difference by 86_400_000 and added one, which mis-counts whenever the two
    // instants are not an exact multiple of 24 hours apart.
    const days = datesInRange(start, end).length;

    const request = await prisma.leaveRequest.create({
      data: { employeeId, type, startDate: start, endDate: end, days, reason, status: 'pending' },
    });

    await logAudit(req.user.id, 'SUBMIT_LEAVE_REQUEST', 'LeaveRequest', request.id, { type, days });
    await notifyAdmins({
      title: 'New leave request',
      message: `${req.user.employee.fullName} requested ${days} day(s) of ${type} leave.`,
      type: 'leave',
      link: '/dashboard/requests',
    });

    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
};

exports.createHalfdayRequest = async (req, res, next) => {
  try {
    const { date, reason } = req.body;
    const employeeId = req.user.employee.id;
    const day = toDateOnly(date);

    if (await hasOverlap('halfdayRequest', employeeId, day, day, 'single')) {
      return res.status(409).json({
        error: 'You already have a pending or approved half-day request for this date.',
      });
    }

    const request = await prisma.halfdayRequest.create({
      data: { employeeId, date: day, reason, status: 'pending' },
    });

    await logAudit(req.user.id, 'SUBMIT_HALFDAY_REQUEST', 'HalfdayRequest', request.id, { date });
    await notifyAdmins({
      title: 'New half-day request',
      message: `${req.user.employee.fullName} requested a half-day.`,
      type: 'leave',
      link: '/dashboard/requests',
    });

    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
};

exports.createWfhRequest = async (req, res, next) => {
  try {
    const { startDate, endDate, reason } = req.body;
    const employeeId = req.user.employee.id;

    const start = toDateOnly(startDate);
    const end = toDateOnly(endDate);

    if (await hasOverlap('wfhRequest', employeeId, start, end, 'range')) {
      return res.status(409).json({
        error: 'You already have a pending or approved WFH request covering these dates.',
      });
    }

    const request = await prisma.wfhRequest.create({
      data: { employeeId, startDate: start, endDate: end, reason, status: 'pending' },
    });

    await logAudit(req.user.id, 'SUBMIT_WFH_REQUEST', 'WfhRequest', request.id, {
      startDate,
      endDate,
    });
    await notifyAdmins({
      title: 'New WFH request',
      message: `${req.user.employee.fullName} requested to work from home.`,
      type: 'leave',
      link: '/dashboard/requests',
    });

    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

exports.getLeaveRequests = makeList('leave');
exports.getHalfdayRequests = makeList('halfday');
exports.getWfhRequests = makeList('wfh');

exports.getMyLeaveRequests = makeMine('leave');
exports.getMyHalfdayRequests = makeMine('halfday');
exports.getMyWfhRequests = makeMine('wfh');

exports.reviewLeaveRequest = makeReview('leave');
exports.reviewHalfdayRequest = makeReview('halfday');
exports.reviewWfhRequest = makeReview('wfh');
