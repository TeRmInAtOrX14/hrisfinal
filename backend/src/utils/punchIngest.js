const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const OFFICE_START = process.env.OFFICE_START_TIME || '09:30';

function timeToMinutes(t) {
  if (!t) return 9 * 60 + 30;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function getLocalDateMidnight(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * Ingests a batch of biometric punches pushed by the sync agent.
 *
 * @param {Array<{ deviceUserId: string|number, timestamp: string }>} punches
 * @returns {Promise<{ synced: number, skipped: number, errors: string[] }>}
 */
async function processBatchPunches(punches) {
  if (!Array.isArray(punches) || punches.length === 0) {
    return { synced: 0, skipped: 0, errors: [] };
  }

  let synced = 0;
  let skipped = 0;
  const errors = [];
  const syncStartedAt = new Date();

  // 1. Fetch active employees to build lookup map
  const employees = await prisma.employee.findMany({
    where: { status: 'active' },
    include: { user: true }
  });

  const employeeMap = {};
  for (const emp of employees) {
    if (emp.employeeCode) employeeMap[emp.employeeCode] = emp;
    if (emp.zkUserId) employeeMap[emp.zkUserId] = emp;

    const num = emp.employeeCode ? emp.employeeCode.replace(/\D/g, '') : '';
    if (num) {
      employeeMap[num] = emp;
      employeeMap[String(Number(num))] = emp;
    }
  }

  // 2. Group punches by (employeeId, date)
  const dayMap = {};

  for (const item of punches) {
    if (!item || !item.deviceUserId || !item.timestamp) {
      skipped++;
      continue;
    }

    const deviceUserId = String(item.deviceUserId).trim();
    const emp = employeeMap[deviceUserId];

    if (!emp) {
      skipped++;
      continue;
    }

    const punchTime = new Date(item.timestamp);
    if (isNaN(punchTime.getTime())) {
      skipped++;
      continue;
    }

    const dateMidnight = getLocalDateMidnight(punchTime);
    const dateKey = dateMidnight.toISOString().split('T')[0];
    const key = `${emp.id}_${dateKey}`;

    if (!dayMap[key]) {
      dayMap[key] = { emp, dateMidnight, punches: [] };
    }
    dayMap[key].punches.push(punchTime);
  }

  const entries = Object.values(dayMap);
  if (entries.length === 0) {
    return { synced: 0, skipped, errors };
  }

  // 3. Batch-fetch existing records to avoid N+1 queries
  const orConditions = entries.map(({ emp, dateMidnight }) => ({
    employeeId: emp.id,
    date: dateMidnight
  }));

  const existingRecords = await prisma.attendance.findMany({
    where: { OR: orConditions }
  });

  const existingMap = {};
  for (const rec of existingRecords) {
    const k = `${rec.employeeId}_${rec.date.toISOString().split('T')[0]}`;
    existingMap[k] = rec;
  }

  // 4. Upsert attendance records
  for (const { emp, dateMidnight, punches } of entries) {
    try {
      punches.sort((a, b) => a - b);

      const deviceCheckIn = punches[0];
      const dateKey = dateMidnight.toISOString().split('T')[0];
      const mapKey = `${emp.id}_${dateKey}`;
      const existing = existingMap[mapKey];

      const finalCheckIn = minDate(existing?.checkIn || null, deviceCheckIn);

      const checkInMinutes = finalCheckIn.getHours() * 60 + finalCheckIn.getMinutes();
      const shiftStartMins = timeToMinutes(emp.shiftStart || OFFICE_START);
      const grace = emp.graceMinutes !== undefined ? emp.graceMinutes : 15;
      const diff = checkInMinutes - shiftStartMins;
      const lateMins = diff > grace ? diff : 0;

      await prisma.attendance.upsert({
        where: {
          employeeId_date: { employeeId: emp.id, date: dateMidnight }
        },
        create: {
          employeeId: emp.id,
          date: dateMidnight,
          status: 'present',
          checkIn: finalCheckIn,
          checkOut: null,
          late: lateMins,
          earlyDeparture: 0,
          overtime: 0,
          zkSyncId: `agent_${syncStartedAt.toISOString()}`
        },
        update: {
          checkIn: finalCheckIn,
          status: 'present',
          late: lateMins,
          zkSyncId: `agent_${syncStartedAt.toISOString()}`
        }
      });

      synced++;
    } catch (err) {
      errors.push(`Failed to save attendance for employee ${emp.employeeCode}: ${err.message}`);
    }
  }

  return { synced, skipped, errors };
}

module.exports = { processBatchPunches };
