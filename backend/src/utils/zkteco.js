const net = require('net');
const fs = require('fs');
const path = require('path');
const ZKLib = require('node-zklib');
const { PrismaClient } = require('@prisma/client');
const { sendMail } = require('./mailer');

const prisma = new PrismaClient();

const DEVICE_IP = process.env.ZKTECO_IP || null;
const DEVICE_PORT = Number(process.env.ZKTECO_PORT) || 4370;
const TIMEOUT = 5000;

// Office hours defaults (overridable via .env)
const OFFICE_START = process.env.OFFICE_START_TIME || '09:30';
const OFFICE_END   = process.env.OFFICE_END_TIME   || '18:30';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Quick TCP probe — checks if the ZKTeco device is on the current network
 * before attempting a full connection. Returns true if reachable.
 */
function isDeviceReachable(ip, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const done = (reachable) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(reachable);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout',  () => done(false));
    socket.on('error',    () => done(false));
    socket.connect(port, ip);
  });
}

/** Read persisted sync state from database. */
async function readSyncState() {
  try {
    const lastRecord = await prisma.attendance.findFirst({
      where: {
        zkSyncId: { startsWith: 'zk_' }
      },
      orderBy: {
        date: 'desc'
      }
    });
    return { lastSyncAt: lastRecord ? lastRecord.date : null };
  } catch (err) {
    console.error('[ZKTeco] Failed to read sync state from DB:', err.message);
    return { lastSyncAt: null };
  }
}

function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Normalizes a device date into a UTC midnight Date representing the local calendar date.
 */
function getLocalDateMidnight(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/**
 * Returns the earlier of two dates (or the non-null one if one is null).
 */
function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * Returns the later of two dates (or the non-null one if one is null).
 */
function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

/**
 * Pulls attendance records from the ZKTeco device and upserts them into the
 * database. Only processes records newer than the last successful sync to
 * avoid redundant work. Uses a batch DB fetch to eliminate N+1 queries.
 *
 * @returns {Promise<{ synced: number, skipped: number, errors: string[] }>}
 */
async function syncZKTeco() {
  if (!DEVICE_IP) {
    return { synced: 0, skipped: 0, errors: ['ZKTECO_IP is not set in environment variables.'] };
  }

  // Network check — skip silently if not on office WiFi
  const reachable = await isDeviceReachable(DEVICE_IP, DEVICE_PORT);
  if (!reachable) {
    console.log(`[ZKTeco] Device at ${DEVICE_IP}:${DEVICE_PORT} not reachable — not on office network, skipping sync.`);
    return { synced: 0, skipped: 0, errors: [] };
  }

  const errors  = [];
  let synced    = 0;
  let skipped   = 0;

  // Determine the cutoff: process records newer than (lastSync - 1 day) to
  // catch checkout punches that might span midnight or were missed.
  // If no prior sync exists, pull the last 60 days as the initial load.
  const { lastSyncAt } = await readSyncState();
  const cutoff = lastSyncAt
    ? new Date(lastSyncAt.getTime() - 24 * 60 * 60 * 1000) // 1-day overlap window
    : new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);     // initial: last 60 days

  const syncStartedAt = new Date();
  console.log(`[ZKTeco] Cutoff for this sync: ${cutoff.toISOString()}`);

  const zk = new ZKLib(DEVICE_IP, DEVICE_PORT, TIMEOUT, 0);

  try {
    await zk.createSocket();
    console.log(`[ZKTeco] Connected to device at ${DEVICE_IP}:${DEVICE_PORT}`);

    // Download ALL punch records from device (ZKTeco protocol has no server-side filter)
    const { data: attendanceLogs } = await zk.getAttendances();
    console.log(`[ZKTeco] Downloaded ${attendanceLogs.length} total punch records from device.`);

    // -----------------------------------------------------------------------
    // 1. Build employee lookup map
    // -----------------------------------------------------------------------
    const employees = await prisma.employee.findMany({
      where: { status: 'active' },
      include: { user: true }
    });

    const employeeMap = {};
    for (const emp of employees) {
      employeeMap[emp.employeeCode] = emp;
      if (emp.zkUserId) employeeMap[emp.zkUserId] = emp;
      // Numeric suffix matching: EMP-003, EMP003 → "3"
      const num = emp.employeeCode.replace(/\D/g, '');
      if (num) {
        employeeMap[num] = emp;
        employeeMap[String(Number(num))] = emp;
      }
    }

    // -----------------------------------------------------------------------
    // 2. Filter + group punches by (employeeId, date)
    //    Only process records newer than cutoff — ignore old history
    // -----------------------------------------------------------------------
    const dayMap = {}; // key: `${employeeId}_${YYYY-MM-DD}`

    for (const log of attendanceLogs) {
      const deviceUserId = String(log.deviceUserId).trim();
      const emp = employeeMap[deviceUserId];

      // Skip unknown device users
      if (!emp) { skipped++; continue; }

      const punchTime = new Date(log.recordTime);

      // Skip records older than our cutoff window
      if (punchTime < cutoff) { skipped++; continue; }

      const dateMidnight = getLocalDateMidnight(punchTime);
      const dateKey      = dateMidnight.toISOString().split('T')[0];
      const key          = `${emp.id}_${dateKey}`;

      if (!dayMap[key]) {
        dayMap[key] = { emp, dateMidnight, punches: [] };
      }
      dayMap[key].punches.push(punchTime);
    }

    const entries = Object.values(dayMap);
    console.log(`[ZKTeco] ${entries.length} employee-day records to process after filtering.`);

    if (entries.length === 0) {
      console.log('[ZKTeco] No new records to sync.');
      return { synced: 0, skipped, errors: [] };
    }

    // -----------------------------------------------------------------------
    // 3. Batch-fetch all existing attendance records in ONE query (no N+1)
    // -----------------------------------------------------------------------
    const orConditions = entries.map(({ emp, dateMidnight }) => ({
      employeeId: emp.id,
      date: dateMidnight
    }));

    const existingRecords = await prisma.attendance.findMany({
      where: { OR: orConditions }
    });

    // Build a lookup map: `${employeeId}_${date}` → existing record
    const existingMap = {};
    for (const rec of existingRecords) {
      const k = `${rec.employeeId}_${rec.date.toISOString().split('T')[0]}`;
      existingMap[k] = rec;
    }

    // -----------------------------------------------------------------------
    // 4. Upsert — smart merge preserving the earliest checkIn & latest checkOut
    // -----------------------------------------------------------------------
    for (const { emp, dateMidnight, punches } of entries) {
      punches.sort((a, b) => a - b);

      const deviceCheckIn  = punches[0];

      const dateKey    = dateMidnight.toISOString().split('T')[0];
      const mapKey     = `${emp.id}_${dateKey}`;
      const existing   = existingMap[mapKey];

      // Merge: always keep the EARLIEST check-in
      const finalCheckIn  = minDate(existing?.checkIn  || null, deviceCheckIn);
      const finalCheckOut = null; // Removed check-out time

      // Recalculate metrics from the merged times
      const checkInMinutes   = finalCheckIn.getHours() * 60 + finalCheckIn.getMinutes();
      const shiftStartMins   = timeToMinutes(emp.shiftStart || OFFICE_START);
      const grace            = emp.graceMinutes !== undefined ? emp.graceMinutes : 15;
      const diff             = checkInMinutes - shiftStartMins;
      const lateMins         = diff > grace ? diff : 0;

      let earlyDepartureMins = 0;
      let overtimeMins       = 0;
      let status             = 'present';

      await prisma.attendance.upsert({
        where: {
          employeeId_date: { employeeId: emp.id, date: dateMidnight }
        },
        create: {
          employeeId:     emp.id,
          date:           dateMidnight,
          status,
          checkIn:        finalCheckIn,
          checkOut:       finalCheckOut,
          late:           lateMins,
          earlyDeparture: earlyDepartureMins,
          overtime:       overtimeMins,
          zkSyncId:       `zk_${syncStartedAt.toISOString()}`
        },
        update: {
          checkIn:        finalCheckIn,
          checkOut:       finalCheckOut,
          status,
          late:           lateMins,
          earlyDeparture: earlyDepartureMins,
          overtime:       overtimeMins,
          zkSyncId:       `zk_${syncStartedAt.toISOString()}`
        }
      });

      synced++;
    }

    // Persist sync state so next run knows where to start
    console.log(`[ZKTeco] Sync complete. Synced: ${synced}, Skipped: ${skipped}`);

  } catch (err) {
    const msg = `[ZKTeco] Sync failed: ${err.message}`;
    console.error(msg);
    errors.push(msg);
    // Do NOT update sync state on failure so next run retries from same window
  } finally {
    try { await zk.disconnect(); } catch (_) {}
  }

  return { synced, skipped, errors };
}

module.exports = { syncZKTeco };
