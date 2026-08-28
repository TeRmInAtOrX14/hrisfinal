const prisma = require('../lib/prisma');
const { syncZKTeco } = require('../utils/zkteco');
const { processBatchPunches } = require('../utils/punchIngest');
const { logAudit } = require('../utils/audit');
const { resolveEmployeeFilter } = require('../utils/scope');
const {
  toDateOnly,
  computeDayMetrics,
  monthBounds,
} = require('../utils/attendanceTime');

const EMPLOYEE_SELECT = {
  select: { id: true, fullName: true, employeeCode: true, designation: true },
};

exports.getAttendance = async (req, res, next) => {
  try {
    const { startDate, endDate, employeeId } = req.query;

    const scope = await resolveEmployeeFilter(req.user, employeeId);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }

    const where = {};
    if (scope.filter !== undefined) where.employeeId = scope.filter;

    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        const from = toDateOnly(startDate);
        if (from) where.date.gte = from;
      }
      if (endDate) {
        const to = toDateOnly(endDate);
        if (to) where.date.lte = to;
      }
    }

    const records = await prisma.attendance.findMany({
      where,
      include: { employee: EMPLOYEE_SELECT },
      orderBy: [{ date: 'desc' }, { checkIn: 'desc' }],
      // A full history for a large team is thousands of rows the table never
      // shows; cap it so one page load cannot pull the entire dataset.
      take: 2000,
    });

    res.json(records);
  } catch (err) {
    next(err);
  }
};

exports.getAttendanceSummary = async (req, res, next) => {
  try {
    const { employeeId, year, month } = req.query;

    if (!employeeId || !year || !month) {
      return res.status(400).json({ error: 'employeeId, year, and month are required' });
    }

    const scope = await resolveEmployeeFilter(req.user, employeeId);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }

    const { start, end, daysInPeriod } = monthBounds(year, month);

    const records = await prisma.attendance.findMany({
      where: { employeeId, date: { gte: start, lte: end } },
    });

    const summary = {
      employeeId,
      year: Number(year),
      month: Number(month),
      daysInPeriod,
      present: 0,
      halfDays: 0,
      leaves: 0,
      wfh: 0,
      absent: 0,
      lateCount: 0,
      totalLateMinutes: 0,
      overtimeMinutes: 0,
      earlyDepartureMinutes: 0,
      totalRecords: records.length,
    };

    for (const rec of records) {
      if (rec.status === 'present') summary.present++;
      else if (rec.status === 'half_day') summary.halfDays++;
      else if (rec.status === 'leave') summary.leaves++;
      else if (rec.status === 'wfh') summary.wfh++;
      else if (rec.status === 'absent') summary.absent++;

      if (rec.late > 0) {
        summary.lateCount++;
        summary.totalLateMinutes += rec.late;
      }
      summary.overtimeMinutes += rec.overtime;
      summary.earlyDepartureMinutes += rec.earlyDeparture;
    }

    // Days actually worked, counting a half-day as half.
    summary.daysWorked = summary.present + summary.wfh + summary.halfDays * 0.5;

    res.json(summary);
  } catch (err) {
    next(err);
  }
};

exports.syncAttendance = async (req, res, next) => {
  try {
    const result = await syncZKTeco();
    await logAudit(req.user.id, 'SYNC_ZKTECO_ATTENDANCE', 'Attendance', null, result);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

/**
 * Admin override for a single employee-day.
 *
 * The check-out the admin entered was previously parsed and then thrown away:
 * both the create and update branches wrote `checkOut: null` unconditionally,
 * and zeroed overtime and early departure. Those values are now stored, and the
 * derived minutes are recomputed from the employee's own shift.
 */
exports.manualPunch = async (req, res, next) => {
  try {
    const { employeeId, date, status, checkIn, checkOut, note } = req.body;

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const dateMidnight = toDateOnly(date);
    if (!dateMidnight) {
      return res.status(400).json({ error: 'Invalid date' });
    }

    const checkInDate = checkIn ? new Date(checkIn) : null;
    const checkOutDate = checkOut ? new Date(checkOut) : null;

    // Leave and WFH days carry no lateness or overtime.
    const isOffDay = status === 'leave' || status === 'wfh' || status === 'holiday';
    const metrics = isOffDay
      ? { late: 0, earlyDeparture: 0, overtime: 0 }
      : computeDayMetrics(employee, checkInDate, checkOutDate);

    const payload = {
      status,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      ...metrics,
      note: note || null,
    };

    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: dateMidnight } },
      create: { employeeId, date: dateMidnight, ...payload },
      update: payload,
    });

    await logAudit(req.user.id, 'MANUAL_ATTENDANCE_PUNCH', 'Attendance', record.id, {
      employeeId,
      date,
      status,
    });

    res.json(record);
  } catch (err) {
    next(err);
  }
};

/** Ingestion endpoint for the office-side sync agent (x-sync-token auth). */
exports.receivePunches = async (req, res, next) => {
  try {
    const { punches } = req.body;
    const result = await processBatchPunches(punches);

    if (result.unmatched.length > 0) {
      console.warn(
        `[Punch Ingest] ${result.unmatched.length} unmatched device id(s): ${result.unmatched
          .slice(0, 20)
          .join(', ')}`
      );
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
};
