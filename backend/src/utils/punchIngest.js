const prisma = require('../lib/prisma');
const {
  officeDateMidnight,
  computeDayMetrics,
} = require('./attendanceTime');

/**
 * Ingest a batch of biometric punches pushed by the office sync agent.
 *
 * Two behaviours changed here:
 *
 *  - Check-out is now recorded. The device reports every punch of the day, but
 *    only the earliest was kept and `checkOut` was hard-coded to null, so
 *    overtime and early-departure were permanently zero across the system.
 *    The earliest punch of the day is the check-in and the latest is the
 *    check-out (when they differ).
 *
 *  - Dates and late minutes are computed in the office timezone rather than the
 *    server's. On a UTC host every Karachi punch was previously scored five
 *    hours early, and evening punches were filed under the previous day.
 */

/** Earliest of two dates, ignoring nulls. */
function earliest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/** Latest of two dates, ignoring nulls. */
function latest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Build a lookup from every identifier the device might report to an employee.
 *
 * Devices are inconsistent about zero-padding and prefixes, so 'EMP-007', '007'
 * and '7' all have to resolve to the same person.
 */
function buildEmployeeLookup(employees) {
  const map = new Map();

  const add = (key, emp) => {
    if (key === undefined || key === null) return;
    const k = String(key).trim();
    // Never let a weaker alias (a derived number) displace an exact match.
    if (k && !map.has(k)) map.set(k, emp);
  };

  // Exact identifiers first so they win over derived aliases.
  for (const emp of employees) {
    add(emp.zkUserId, emp);
    add(emp.employeeCode, emp);
  }

  for (const emp of employees) {
    const digits = emp.employeeCode ? emp.employeeCode.replace(/\D/g, '') : '';
    if (digits) {
      add(digits, emp);
      add(String(Number(digits)), emp);
    }
  }

  return map;
}

/**
 * @param {Array<{ deviceUserId: string|number, timestamp: string }>} punches
 * @returns {Promise<{ synced: number, skipped: number, unmatched: string[], errors: string[] }>}
 */
async function processBatchPunches(punches) {
  if (!Array.isArray(punches) || punches.length === 0) {
    return { synced: 0, skipped: 0, unmatched: [], errors: [] };
  }

  let skipped = 0;
  const errors = [];
  const unmatched = new Set();
  const syncStartedAt = new Date();

  const employees = await prisma.employee.findMany({ where: { status: 'active' } });
  const employeeMap = buildEmployeeLookup(employees);

  // 1. Group punches by (employee, office-local date).
  const dayMap = new Map();

  for (const item of punches) {
    if (!item || item.deviceUserId === undefined || !item.timestamp) {
      skipped++;
      continue;
    }

    const deviceUserId = String(item.deviceUserId).trim();
    const emp = employeeMap.get(deviceUserId);

    if (!emp) {
      skipped++;
      unmatched.add(deviceUserId);
      continue;
    }

    const punchTime = new Date(item.timestamp);
    if (Number.isNaN(punchTime.getTime())) {
      skipped++;
      continue;
    }

    const dateMidnight = officeDateMidnight(punchTime);
    const key = `${emp.id}_${dateMidnight.toISOString().slice(0, 10)}`;

    let entry = dayMap.get(key);
    if (!entry) {
      entry = { emp, dateMidnight, first: null, last: null };
      dayMap.set(key, entry);
    }
    entry.first = earliest(entry.first, punchTime);
    entry.last = latest(entry.last, punchTime);
  }

  const entries = [...dayMap.values()];
  if (entries.length === 0) {
    return { synced: 0, skipped, unmatched: [...unmatched], errors };
  }

  // 2. Batch-fetch the existing rows so the merge below is a single round trip.
  const existingRecords = await prisma.attendance.findMany({
    where: {
      OR: entries.map(({ emp, dateMidnight }) => ({ employeeId: emp.id, date: dateMidnight })),
    },
  });

  const existingMap = new Map(
    existingRecords.map((rec) => [
      `${rec.employeeId}_${rec.date.toISOString().slice(0, 10)}`,
      rec,
    ])
  );

  // 3. Merge each day into its attendance row.
  let synced = 0;

  for (const { emp, dateMidnight, first, last } of entries) {
    try {
      const key = `${emp.id}_${dateMidnight.toISOString().slice(0, 10)}`;
      const existing = existingMap.get(key);

      // Re-sending punches must never move a check-in later or a check-out
      // earlier, so merge against whatever is already stored.
      const checkIn = earliest(existing?.checkIn || null, first);
      const checkOut = latest(existing?.checkOut || null, last > first ? last : null);

      const { late, earlyDeparture, overtime } = computeDayMetrics(emp, checkIn, checkOut);

      // An approved leave/WFH/half-day already decided this day. A stray punch
      // must not silently overwrite that decision back to 'present'.
      const decidedStatuses = ['leave', 'wfh', 'half_day', 'holiday'];
      const keepExistingStatus = existing && decidedStatuses.includes(existing.status);
      const status = keepExistingStatus ? existing.status : 'present';
      const isOffDay = status === 'leave' || status === 'wfh';

      await prisma.attendance.upsert({
        where: { employeeId_date: { employeeId: emp.id, date: dateMidnight } },
        create: {
          employeeId: emp.id,
          date: dateMidnight,
          status: 'present',
          checkIn,
          checkOut,
          late,
          earlyDeparture,
          overtime,
          zkSyncId: `agent_${syncStartedAt.toISOString()}`,
        },
        update: {
          status,
          checkIn,
          checkOut,
          late: isOffDay ? 0 : late,
          earlyDeparture: isOffDay ? 0 : earlyDeparture,
          overtime: isOffDay ? 0 : overtime,
          zkSyncId: `agent_${syncStartedAt.toISOString()}`,
        },
      });

      synced++;
    } catch (err) {
      errors.push(`Failed to save attendance for ${emp.employeeCode}: ${err.message}`);
    }
  }

  return { synced, skipped, unmatched: [...unmatched], errors };
}

module.exports = { processBatchPunches, buildEmployeeLookup };
