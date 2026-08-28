require('dotenv').config();

const net = require('net');
const fs = require('fs');
const path = require('path');
const ZKLib = require('node-zklib');

/**
 * Brandigade HRIS — office-side biometric sync agent.
 *
 * The HRIS server runs on shared hosting and cannot reach the ZKTeco device on
 * the office LAN. This agent runs on an office machine that can: it reads
 * punches from the device and POSTs them to the server, which does all the
 * attendance logic.
 *
 * Run it on a schedule (Task Scheduler on Windows, cron on Linux). Overlapping
 * or repeated runs are safe — the server upserts, so re-sending punches it has
 * already seen changes nothing.
 */

const API_URL     = (process.env.HRIS_API_URL || '').replace(/\/$/, '');
const TOKEN       = process.env.SYNC_AGENT_TOKEN;
const DEVICE_IP   = process.env.ZKTECO_IP;
const DEVICE_PORT = Number(process.env.ZKTECO_PORT) || 4370;
const TIMEOUT     = Number(process.env.ZKTECO_TIMEOUT_MS) || 10000;

// How far back to read on a normal run. The overlap absorbs clock skew and
// punches that landed while a previous run was mid-flight.
const LOOKBACK_DAYS      = Number(process.env.LOOKBACK_DAYS) || 3;
const FULL_LOOKBACK_DAYS = Number(process.env.FULL_LOOKBACK_DAYS) || 60;
const BATCH_SIZE         = Number(process.env.BATCH_SIZE) || 2000;

const STATE_FILE = path.join(__dirname, '.sync-state.json');
const FULL_SYNC  = process.argv.includes('--full');

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function fail(message) {
  console.error(`[${new Date().toISOString()}] ERROR:`, message);
  process.exit(1);
}

/** Quick TCP probe so we fail fast when off the office network. */
function isDeviceReachable(ip, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (reachable) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(reachable);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    socket.connect(port, ip);
  });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('Could not persist sync state:', err.message);
  }
}

async function postPunches(punches) {
  const res = await fetch(`${API_URL}/attendance/punches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sync-token': TOKEN,
    },
    body: JSON.stringify({ punches }),
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`Server responded ${res.status}: ${body.error || text.slice(0, 200)}`);
  }
  return body;
}

async function main() {
  if (!API_URL)   fail('HRIS_API_URL is not set (e.g. https://api.brandigade.com/api)');
  if (!TOKEN)     fail('SYNC_AGENT_TOKEN is not set — it must match the server value');
  if (!DEVICE_IP) fail('ZKTECO_IP is not set');

  log(`Probing device at ${DEVICE_IP}:${DEVICE_PORT} ...`);
  const reachable = await isDeviceReachable(DEVICE_IP, DEVICE_PORT);
  if (!reachable) {
    // Not an error: the agent may run on a laptop that is off the office
    // network right now. Exit quietly so scheduled runs do not spam alerts.
    log('Device not reachable — not on the office network. Nothing to do.');
    return;
  }

  const state = readState();
  const lookbackDays = FULL_SYNC ? FULL_LOOKBACK_DAYS : LOOKBACK_DAYS;
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  log(`Reading punches since ${cutoff.toISOString()} (${lookbackDays}-day window${FULL_SYNC ? ', full sync' : ''})`);

  const zk = new ZKLib(DEVICE_IP, DEVICE_PORT, TIMEOUT, 0);
  let rawLogs = [];

  try {
    await zk.createSocket();
    log('Connected to device.');
    const result = await zk.getAttendances();
    rawLogs = result?.data || [];
    log(`Device returned ${rawLogs.length} total punch records.`);
  } catch (err) {
    try { await zk.disconnect(); } catch {}
    fail(`Could not read from device: ${err.message}`);
  }

  try { await zk.disconnect(); } catch {}

  // Normalize to the shape the server expects. Timestamps go out as absolute
  // ISO-8601 instants so the server never has to guess a timezone.
  const punches = [];
  for (const entry of rawLogs) {
    const ts = new Date(entry.recordTime);
    if (isNaN(ts.getTime()) || ts < cutoff) continue;
    punches.push({
      deviceUserId: String(entry.deviceUserId).trim(),
      timestamp: ts.toISOString(),
    });
  }

  if (punches.length === 0) {
    log('No punches in the window. Nothing to send.');
    writeState({ ...state, lastRunAt: new Date().toISOString(), lastSent: 0 });
    return;
  }

  log(`Sending ${punches.length} punches to ${API_URL} ...`);

  let totalSynced = 0;
  let totalSkipped = 0;

  for (let i = 0; i < punches.length; i += BATCH_SIZE) {
    const batch = punches.slice(i, i + BATCH_SIZE);
    const batchNo = Math.floor(i / BATCH_SIZE) + 1;
    try {
      const result = await postPunches(batch);
      totalSynced += result.synced || 0;
      totalSkipped += result.skipped || 0;
      log(`Batch ${batchNo}: sent ${batch.length}, synced ${result.synced}, skipped ${result.skipped}`);
      if (result.errors?.length) {
        for (const e of result.errors) console.warn('  server warning:', e);
      }
    } catch (err) {
      // Leave the watermark untouched so the next run retries this window.
      fail(`Batch ${batchNo} failed: ${err.message}`);
    }
  }

  writeState({
    lastRunAt: new Date().toISOString(),
    lastSent: punches.length,
    lastSynced: totalSynced,
  });

  log(`Done. Records written: ${totalSynced}, skipped (unknown device users): ${totalSkipped}`);
}

main().catch((err) => fail(err.stack || err.message));
