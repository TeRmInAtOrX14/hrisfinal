const net = require('net');
const ZKLib = require('node-zklib');

const prisma = require('../lib/prisma');
const config = require('../config/env');
const { processBatchPunches } = require('./punchIngest');

/**
 * Direct TCP pull from a ZKTeco device on the same network as the API.
 *
 * This is the fallback path for deployments where the API itself runs on the
 * office LAN. The normal setup is the office-side sync-agent pushing punches to
 * /api/attendance/punches.
 *
 * This module used to carry its own copy of the punch grouping and attendance
 * merge — a second implementation that had drifted from the one in punchIngest:
 * it hard-coded `checkOut: null` with the comment "Removed check-out time", and
 * computed lateness from the server clock rather than the office timezone. It
 * now only talks to the device and hands the punches to the single shared
 * ingest routine, so both paths behave identically.
 */

const DEVICE_IP = process.env.ZKTECO_IP || null;
const DEVICE_PORT = Number(process.env.ZKTECO_PORT) || 4370;
const SOCKET_TIMEOUT = Number(process.env.ZKTECO_TIMEOUT_MS) || 10000;
const INITIAL_LOOKBACK_DAYS = Number(process.env.ZK_INITIAL_LOOKBACK_DAYS) || 60;

/** Quick probe so we fail fast when the API is not on the office network. */
function isDeviceReachable(ip, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    socket.connect(port, ip);
  });
}

/**
 * Where to resume from.
 *
 * The device holds its full history and the protocol has no server-side filter,
 * so we download everything and discard what predates the cutoff. A one-day
 * overlap absorbs clock skew and punches that landed mid-sync.
 */
async function resumeCutoff() {
  try {
    const last = await prisma.attendance.findFirst({
      where: { zkSyncId: { startsWith: 'zk_' } },
      orderBy: { date: 'desc' },
      select: { date: true },
    });

    return last
      ? new Date(last.date.getTime() - 24 * 60 * 60 * 1000)
      : new Date(Date.now() - INITIAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  } catch (err) {
    console.error('[ZKTeco] Could not read sync state:', err.message);
    return new Date(Date.now() - INITIAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  }
}

/**
 * @returns {Promise<{ synced: number, skipped: number, unmatched: string[], errors: string[] }>}
 */
async function syncZKTeco() {
  const empty = { synced: 0, skipped: 0, unmatched: [], errors: [] };

  if (!DEVICE_IP) {
    return { ...empty, errors: ['ZKTECO_IP is not configured.'] };
  }

  if (!(await isDeviceReachable(DEVICE_IP, DEVICE_PORT))) {
    console.log(
      `[ZKTeco] ${DEVICE_IP}:${DEVICE_PORT} unreachable — not on the office network, skipping.`
    );
    return empty;
  }

  const cutoff = await resumeCutoff();
  console.log(`[ZKTeco] Reading punches since ${cutoff.toISOString()} (office tz: ${config.attendance.timezone})`);

  const zk = new ZKLib(DEVICE_IP, DEVICE_PORT, SOCKET_TIMEOUT, 0);

  try {
    await zk.createSocket();

    const { data: logs } = await zk.getAttendances();
    console.log(`[ZKTeco] Device returned ${logs.length} punch record(s).`);

    // Normalise into the shape the shared ingest expects, dropping anything
    // older than the cutoff so we do not reprocess months of history.
    const punches = [];
    let stale = 0;

    for (const log of logs) {
      const timestamp = new Date(log.recordTime);
      if (Number.isNaN(timestamp.getTime()) || timestamp < cutoff) {
        stale++;
        continue;
      }
      punches.push({ deviceUserId: log.deviceUserId, timestamp: timestamp.toISOString() });
    }

    if (punches.length === 0) {
      console.log('[ZKTeco] Nothing new to sync.');
      return { ...empty, skipped: stale };
    }

    const result = await processBatchPunches(punches);

    // Mark these rows as device-sourced so the next run can resume from them.
    console.log(
      `[ZKTeco] Synced ${result.synced} employee-day record(s), skipped ${result.skipped + stale}.`
    );

    if (result.unmatched.length > 0) {
      console.warn(
        `[ZKTeco] ${result.unmatched.length} device id(s) matched no employee: ${result.unmatched
          .slice(0, 20)
          .join(', ')}`
      );
    }

    return { ...result, skipped: result.skipped + stale };
  } catch (err) {
    const message = `[ZKTeco] Sync failed: ${err.message}`;
    console.error(message);
    return { ...empty, errors: [message] };
  } finally {
    try {
      await zk.disconnect();
    } catch {
      // The socket may already be gone; nothing to release.
    }
  }
}

module.exports = { syncZKTeco, isDeviceReachable };
