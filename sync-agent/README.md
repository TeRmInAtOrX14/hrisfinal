# Biometric Attendance Sync Agent — Installation Guide

This installs on **one computer inside the Brandigade office** — the machine that
stays on during working hours and is on the same network as the ZKTeco
attendance device.

It reads attendance punches from the device and sends them to the HRIS.

---

## Why this is needed

The HRIS runs on Namecheap hosting, out on the internet. The ZKTeco device has a
private office address (something like `192.168.1.201`) that only computers
inside the office can reach. A server on the internet cannot dial into your
office network.

So the direction is reversed: this small program sits inside the office, reads
the device, and pushes the punches out to the HRIS.

```
  ZKTeco device            Office PC                     Namecheap
  192.168.1.201   ──────►  sync agent   ──── HTTPS ────►  HRIS
  (office LAN)             (this guide)                   (api.brandigade.com)
```

**Without this, attendance will not appear in the HRIS at all.** Everything else
(payroll, leave, campaigns) works regardless — only biometric attendance depends
on it.

### What it sends

Only two fields per punch: the **device user ID** and the **timestamp**. No
names, no salaries, nothing else. All the interpretation — matching IDs to
employees, working out late minutes — happens on the server.

---

## Requirements

- A Windows or Linux computer in the office that is **on during working hours**.
  The machine already running your ZKTeco software is ideal.
- That computer must reach the attendance device on the local network.
- **Node.js 18 or newer.**
- The `sync-agent` folder from the HRIS project.

---

## Step 1 — Find the device's IP address

On the ZKTeco device itself:

**Menu → Comm. → Ethernet** (wording varies by model — may be *Network* or
*Comm. Settings*)

Write down the **IP Address**. It usually looks like `192.168.1.xxx`.

Also note the **port** if shown. Almost always `4370`.

> Give the device a **static/reserved IP** on your router. If it's on DHCP the
> address can change after a power cut and the agent will silently stop finding
> it.

### Check the office PC can reach it

Open Command Prompt (Windows) or Terminal (Linux) and run — substituting your
address:

```bash
ping 192.168.1.201
```

You should see replies. If it times out, the PC and the device are not on the
same network, and nothing below will work until that's fixed.

---

## Step 2 — Install Node.js

Download the **LTS** version from <https://nodejs.org> and install it with the
default options.

Confirm it worked — open a **new** terminal window and run:

```bash
node -v
```

You should see something like `v24.19.0`. If the command isn't recognised, close
and reopen the terminal (the installer updates PATH only for new windows).

---

## Step 3 — Copy the agent onto the office PC

Copy the `sync-agent` folder somewhere permanent — **not** the Desktop or
Downloads, where it might get cleaned up. For example:

```
C:\brandigade\sync-agent
```

Then open a terminal in that folder and install its dependencies:

```bash
npm install
```

---

## Step 4 — Configure it

In the `sync-agent` folder, copy `.env.example` to a new file named `.env`:

```bash
copy .env.example .env
```

(On Linux/macOS use `cp .env.example .env`.)

Open `.env` in Notepad and fill in:

| Setting | What to put |
|---|---|
| `HRIS_API_URL` | `https://api.brandigade.com/api` — must end in `/api` |
| `SYNC_AGENT_TOKEN` | The long secret from the server (see below) |
| `ZKTECO_IP` | The device address from Step 1 |
| `ZKTECO_PORT` | `4370` unless your device differs |

### About the token

`SYNC_AGENT_TOKEN` is a shared password that proves to the HRIS that punches are
coming from your office and not from a stranger. It must match the
`SYNC_AGENT_TOKEN` value set on the server **exactly**.

Generate it once with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Paste the same value into both:
- the server's environment (cPanel → Setup Node.js App → Environment variables)
- this `.env` file

> Treat it like a password. Anyone holding it can submit attendance records.
> Don't email it or paste it into a group chat — and never commit `.env` to git.

---

## Step 5 — First run (historical backfill)

This pulls the **last 60 days** of attendance so existing history appears in the
HRIS:

```bash
npm run full-sync
```

Expected output:

```
[2026-08-11T...] Probing device at 192.168.1.201:4370 ...
[2026-08-11T...] Connected to device.
[2026-08-11T...] Device returned 648 total punch records.
[2026-08-11T...] Sending 214 punches to https://api.brandigade.com/api ...
[2026-08-11T...] Batch 1: sent 214, synced 198, skipped 16
[2026-08-11T...] Done. Records written: 198, skipped (unknown device users): 16
```

**"Skipped" is normal** — those are device users with no matching employee in the
HRIS. To fix, set each employee's **Biometric ZK Device User ID** field in the
HRIS (Employees → Edit Profile) to their enrollment number on the device.

### Confirm it worked

Log into the HRIS as an admin and open **Attendance**. The dot on the
*Biometric Sync* button should be **green**, and punch records should be listed.

---

## Step 6 — Run it automatically every 2 hours

### Windows (Task Scheduler)

1. Press `Win + R`, type `taskschd.msc`, press Enter.
2. Click **Create Task** (not "Create Basic Task").
3. **General** tab:
   - Name: `Brandigade Attendance Sync`
   - Select **Run whether user is logged on or not**
   - Tick **Run with highest privileges**
4. **Triggers** tab → **New**:
   - Begin the task: *On a schedule*
   - **Daily**, recur every 1 day
   - Tick **Repeat task every** → `2 hours` → for a duration of **Indefinitely**
5. **Actions** tab → **New**:
   - Action: *Start a program*
   - Program/script: `node`
   - Add arguments: `index.js`
   - **Start in:** `C:\brandigade\sync-agent`  ← must be set, or it will fail
6. **Settings** tab:
   - Tick **Run task as soon as possible after a scheduled start is missed**
7. Click OK and enter the Windows password when prompted.

Test it: right-click the task → **Run**, then check **Attendance** in the HRIS.

### Linux / macOS (cron)

```bash
crontab -e
```

Add:

```
0 */2 * * * cd /opt/brandigade/sync-agent && /usr/bin/node index.js >> sync.log 2>&1
```

---

## How it behaves day to day

- **Safe to run repeatedly.** Each run re-reads the last 3 days and re-sends
  them. The server updates existing records instead of duplicating, so overlap
  costs nothing and automatically fills gaps from any runs that were missed.
- **Quiet when off-network.** If the PC is a laptop that leaves the office, the
  agent notices the device is unreachable, logs one line, and exits normally. No
  errors, no duplicate alerts.
- **Fails loudly when it matters.** A rejected token or a server error exits with
  an error and does **not** advance its position, so the next run retries the
  same window.
- **The device keeps its own records.** If the agent is off for a week, the next
  run with `npm run full-sync` recovers everything still stored on the device.

---

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| `Device not reachable — not on the office network` | The PC can't see the device | Check `ZKTECO_IP`, confirm the device is powered on, verify with `ping` |
| `Server responded 401` | Token mismatch | `SYNC_AGENT_TOKEN` differs between `.env` and the server |
| `Server responded 503` | Token not set on the server | Add `SYNC_AGENT_TOKEN` in cPanel → Setup Node.js App, then restart it |
| `HRIS_API_URL is not set` | `.env` missing or empty | Confirm `.env` exists in the `sync-agent` folder (not `.env.txt` — Notepad adds that) |
| Punches sent but `synced: 0` | No employee matches the device IDs | Set each employee's **Biometric ZK Device User ID** in the HRIS |
| Times are several hours off | Server timezone wrong | Set `TZ=Asia/Karachi` in the server environment |
| `node: command not found` | Node not installed, or stale terminal | Reinstall Node, open a **new** terminal |
| Scheduled task does nothing | "Start in" not set | Set **Start in** to the agent folder in Task Scheduler |

### Checking the logs

The agent prints everything it does. Under Task Scheduler that output isn't
captured by default, so to keep a log file change the action arguments to:

```
index.js >> sync.log 2>&1
```

Then read `sync.log` in the agent folder.

---

## Quick reference

| | |
|---|---|
| Normal run | `npm start` |
| Full 60-day backfill | `npm run full-sync` |
| Config file | `.env` in the agent folder |
| Schedule | Every 2 hours |
| Health check | HRIS → Attendance → green dot on *Biometric Sync* |
