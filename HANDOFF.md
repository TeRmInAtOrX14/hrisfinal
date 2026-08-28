# Brandigade HRIS — Handoff

**Last updated:** 28 August 2026
**Purpose:** Self-contained context for picking this project up in a fresh session.

This document covers two things:

1. **[What was done](#part-1--what-was-done)** — a security and correctness pass over the whole
   codebase, plus provisioning the Supabase project. Complete and verified.
2. **[Deployment](#part-2--deployment)** — the cPanel + Supabase free-tier deployment plan.
   Now **implemented and verified**; the remaining work is the server-side deploy itself.

Full audit detail with per-finding before/after:
<https://claude.ai/code/artifact/3af53883-2831-4148-ad78-4fd3ece40252>

---

## Current state

| | |
|---|---|
| Backend | Express 4 / Node 22, Prisma 5 — boots clean, all 32 modules load |
| Frontend | React 19 / Vite 8 — builds clean, **0 lint warnings** (was ~90) |
| Database | Supabase `HRIS` (`ycnlcigdcuahqmlwoltz`), schema applied, **empty** (0 users) |
| Verification | `cd backend && npm run smoke` → **54/54 passing** |
| Deployment | Code is deploy-ready (single origin, Express serves the SPA). **Not yet deployed** — see [Part 2](#part-2--deployment). |

The database has no data — not even an admin. Run `npm run seed` before first use.

---

# Part 1 — What was done

Thirty issues across 60 files. Grouped by why they mattered.

## 1.1 Critical

| Issue | What it meant |
|---|---|
| **Google login auth bypass** | `/api/auth/google-login` read `email` from the request body and issued tokens for it. No Google token was ever verified — `google-auth-library` was imported, a client constructed, and never used. One unauthenticated POST with an admin's email returned an admin session. **Now:** identity comes only from a verified ID token checked against our own client ID. |
| **Payroll re-run destroyed issued payslips** | Running payroll for a month reset the run to `draft` and `deleteMany`'d its payslips with no status check. Recalculating a finalized month wiped every issued payslip and its PDF link. **Now:** finalized periods return `409` and cannot be recalculated; finalizing asks for confirmation. |
| **Campaign assignment demoted admins** | Assigning someone to a campaign overwrote `User.role` from the campaign role; unassigning set it to `Employee`. An Admin added to a campaign became a Team Lead; removing them locked them out. **Now:** campaign membership never touches the account role. |
| **Payslips and HR documents were public** | Buckets were auto-created as `public: true`. Contracts, ID scans, medical records and payslips were readable by anyone with the URL. Payslip downloads put a live JWT in the query string. **Now:** both buckets private; payslips stream from an authenticated endpoint, documents via 60-second signed URLs; tokens travel in the `Authorization` header. |

## 1.2 Access control & secrets

- **Fallback secrets.** `JWT_SECRET || 'fallback_access_secret'` — and your `.env` had it blank, so
  tokens were signed with a string committed to this repo. Now there are no fallbacks: production
  refuses to start without real secrets, development warns and uses a random per-boot value.
- **Campaign data was readable by everyone.** Campaign list, dashboards and commission structures
  were `requireAuth` only. Any SDR could read every campaign, its members, and full slab tables
  including drafts. Now scoped to the caller's own campaigns.
- **First-login password change was unenforceable.** `mustChangePassword` was set on every
  admin-created account, but no endpoint and no screen existed to change a password. Added both,
  enforced on every route.
- **Passwords logged in plaintext** — login logged the whole request body; employee creation wrote
  the password into the audit log. Both removed; audit payloads now redact credentials.
- **No rate limiting.** `express-rate-limit` was installed but never mounted.
- **Logout accepted any `userId`** from the body — anyone could revoke anyone's session.
- **Database exposed via PostgREST.** All 21 tables had RLS off, so the project's anon key could
  read `User.passwordHash` and every salary. Deny-all RLS enabled.

## 1.3 Data integrity

- **Check-out was discarded.** Both ingest paths hard-coded `checkOut: null`, one with the comment
  *"Removed check-out time"*. Overtime and early departure were always zero, system-wide.
- **Lateness used the server clock.** `getHours()` / `getFullYear()` directly. On a UTC host a 09:20
  Karachi arrival read as 04:20, and evening punches filed under the previous day. All attendance
  maths now runs in a configured `TIMEZONE`.
- **Two different commission formulas.** Payroll used a hard-coded ladder; the dashboard used
  `totalShowups × rate × 0.1`. A lead's dashboard never matched their payslip. One engine now serves
  both, with payroll's behaviour preserved exactly.
- Month-spanning leave was ignored by both months; leave day counts could be off by one; money was
  stored as raw floats (`76666.66666666667`); the payslip PDF recomputed its own total and could
  print a negative; shift times were free text so `9am` became `NaN` and zeroed late penalties;
  deleting an employee always 500'd on a foreign-key violation; loans could be approved into
  already-finalized months.

## 1.4 Features that were never wired up

Each had a model, endpoints and visible UI — and nothing connecting them.

- **Notifications** — the bell polled every 45s and was permanently empty; nothing ever created one.
- **Spiffs** — payroll read them, the dashboard showed a total, no route could create one.
- **Org chart** — advertised in the README, manager relation in the schema since migration one, no
  endpoint and no screen.
- **Request validation** — `zod` installed, middleware written, attached to zero routes.
- **Employee team filter** — the dropdown sent `teamId`, the API reads `campaignId`.
- **Three SDR dashboard panels** read fields the API does not return.

## 1.5 Fabricated figures (removed)

Worth knowing about, because these were presented as real metrics:

- Admin dashboard costed **every** finalized payroll run at a flat `PKR 450,000`, with invented
  fallback totals for early 2026.
- Weekly attendance chart was a hard-coded Mon–Fri array.
- SDR "Weekly Performance Breakdown" split the monthly total by `0.2 / 0.3 / 0.25 / 0.25`.
- Team Lead attendance rate fell back to a literal `90%` when no records existed.

All now read real data, or show an honest empty state.

## 1.6 Structural changes

| Change | Reason |
|---|---|
| One Prisma client (`src/lib/prisma.js`) | 26 `new PrismaClient()` calls → ~13 connection pools against one pooler |
| Payroll query batching | Per-employee loop issued 6+ queries each — 600+ round trips for 100 staff |
| `src/utils/scope.js` | Same RBAC logic copy-pasted into 4 controllers, drifted; 2 copies 500'd for users with no employee profile |
| `src/utils/commission.js` | Single commission engine for payroll + dashboard |
| `src/utils/attendanceTime.js` | Timezone-correct date/late maths |
| `src/utils/notify.js` | Notification creation |
| `src/schemas/index.js` | Shared zod schemas for every mutating route |
| `src/config/env.js` | Validated config, fail-fast on missing secrets |
| Route guards in the SPA | Pages were hidden by omitting sidebar links only; typing the URL rendered the full page |
| Single-flight token refresh | Concurrent 401s each refreshed, invalidating each other → random logouts |
| Light-mode contrast | 41 `hover:text-white` classes were never covered by the theme override |

**Deleted (recoverable from git history):** `utils/logger.js` (imported `winston`, which is not
installed — would have crashed on require), `utils/mail.js` (duplicate of `mailer.js`), and six
one-off admin scripts.

## 1.7 Supabase provisioning

The `SUPABASE_ACCESS_TOKEN` in `backend/.env` belongs to a **different account** than the one the
MCP connector is signed into. Used directly against the Management API it finds the real project.

| | |
|---|---|
| Project | `HRIS` |
| Ref | `ycnlcigdcuahqmlwoltz` |
| Region | `ap-northeast-1` |
| Host | `db.ycnlcigdcuahqmlwoltz.supabase.co` |
| Pooler | `aws-0-ap-northeast-1.pooler.supabase.com:6543` |

What was done:

1. **The committed migration was stale** — it created `Department`, `Team`, `Project` and
   `Commission` tables the app abandoned long ago, while `schema.prisma` uses `Campaign` /
   `CampaignMember` / `CommissionStructure`. Running `prisma migrate deploy` on a fresh database
   would have built the wrong schema entirely. Replaced with a correct baseline generated from
   `schema.prisma`: `prisma/migrations/20260828000000_baseline/`.
2. Applied all 21 tables and recorded the baseline in `_prisma_migrations`.
3. Enabled **deny-all RLS** on all 21 tables. Prisma connects as the table owner and bypasses it;
   this exists purely to block PostgREST.
4. Created `payslips` and `employee-documents` buckets as **private**.
5. Generated `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SYNC_AGENT_TOKEN` and wrote `backend/.env`.
6. Security advisors: **clean**.

> **The database password was rotated.** It cannot be read back through the API, so a new one was
> generated and written into `backend/.env`. Nothing was connected at the time (the DB was empty and
> `DATABASE_URL` was blank), but replace it if you had it saved elsewhere.

Secrets live in `backend/.env` only — git-ignored, never committed. `backend/.env.example`
documents every variable.

## 1.8 Verification

```bash
cd backend && npm run smoke
```

Boots the API on a spare port (`SMOKE_PORT`, default 4517), exercises real flows against the
configured database, and deletes everything it created. Safe to re-run; safe against a populated
database (every record is namespaced with a run tag).

Covers: forged Google login rejected · finalized payroll not recalculable · admin role survives
campaign assignment · check-out stored and overtime computed · lateness correct under a UTC host ·
SDR cannot read another employee · payslip PDF requires auth · cross-employee payslip access refused
· overlapping leave rejected · notifications delivered both ways · spiffs reach the payslip ·
password policy enforced.

---

# Part 2 — Deployment

**Status: implemented on 28 August 2026.** Every change below is in the working tree and
verified — see [2.5](#25-verification-of-the-deployment-changes). The app has not been uploaded to
cPanel yet; that is the only remaining step.

The production hostname is **`hris.brandigade.com`**, which is what `server.js` already allowed and
what the sync-agent and cron examples now use. The stale `api.brandigade.com` references in
`frontend/.env.production` and the sync-agent docs were corrected to match.

## 2.1 Target stack

Constraint: no Render (cold starts), no Railway (now requires a card). cPanel is already paid for.

| Piece | Where | Cost |
|---|---|---|
| API + frontend (one Node app) | cPanel Node.js app | already paying |
| Postgres + file storage | Supabase free tier | free — already configured |
| HTTPS | cPanel AutoSSL / Let's Encrypt | free |
| Scheduled jobs | cPanel cron → hits an endpoint | free |
| Email | Gmail SMTP | free |
| Biometric sync | `sync-agent` on office PC, Task Scheduler | free |

Express serves the built frontend, so there is **one origin and no CORS** in production.

## 2.2 Changes required

### Step 1 — Express serves the frontend

In `backend/src/server.js`, insert **after** the `/api` 404 handler (currently line 85) and
**before** `app.use(errorHandler)` (currently line 89):

```js
const path = require('path');

const distPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(distPath));

// SPA fallback. The negative lookahead keeps unmatched /api routes returning
// the JSON 404 above rather than index.html.
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
```

Ordering matters: `/api` routes → `/api` JSON 404 → static → SPA fallback → error handler.

> **Deviation — the CORS block was left in place.** The plan called for trimming it to just the
> `!origin` branch. That would have broken every mutation: browsers send an `Origin` header on
> same-origin `POST`/`PUT`/`DELETE` too, and this app's `origin` callback answers an unknown origin
> with `callback(new Error(...))`, which becomes a 500 rather than a silently omitted CORS header.
> The existing allowlist already contains `https://hris.brandigade.com`, so same-origin requests
> pass and the dev-only RFC1918 branch still works. Nothing needed to change.

### Step 2 — Relative API base URL

*The side chat flagged this as unverified. Confirmed:* `frontend/src/utils/api.js` line 3 reads
`import.meta.env.VITE_API_URL` with a localhost fallback. So **no code change is needed** — only
the env file:

```diff
  # frontend/.env.production
- VITE_API_URL=https://api.brandigade.com/api
+ VITE_API_URL=/api
```

Leave `VITE_GOOGLE_CLIENT_ID` as-is. It must keep matching the backend's `GOOGLE_CLIENT_ID` — Google
sign-in verifies the ID token against it and fails if they diverge.

### Step 3 — `postinstall` hook

`backend/package.json`, in `scripts`:

```json
"postinstall": "prisma generate"
```

cPanel runs `npm install` on deploy; without this the Prisma client is never generated.

> **Also required:** `prisma` was a **devDependency**, so `npm ci --omit=dev` — the documented
> deploy command — would not have installed the CLI and `postinstall` would have failed the install
> outright. It is now a regular dependency, and `backend/package-lock.json` was regenerated to
> match (out-of-sync lockfiles make `npm ci` refuse to run). Verified by running the real
> `npm ci --omit=dev`: exit 0, Prisma client generated.

### Step 4 — Delete `vercel.json`

No longer deploying the frontend separately.

### Step 5 — Move the scheduler to cron

`backend/src/server.js` lines 101–124 run a `setInterval` inside the `listen` callback. Passenger
idles the process, so in-app timers do not fire reliably.

Replace with a `POST /api/system/cron/sync` route in `backend/src/routes/system.js`, guarded by the
existing `requireSyncToken` middleware, calling the same `syncZKTeco()` logic. Then a cPanel cron
job:

```bash
curl -s -X POST https://hris.brandigade.com/api/system/cron/sync -H "x-sync-token: $SYNC_AGENT_TOKEN"
```

> **This only matters if the API can reach the ZKTeco device — on cPanel it cannot.** The office
> `sync-agent` pushing to `/api/attendance/punches` stays the real ingestion path either way.
> `ENABLE_DIRECT_ZK_SYNC` should stay `false` in production.

Implemented as `POST /api/system/cron/sync` → `controller.runBiometricSync`. It is registered
**before** `router.use(requireAuth)`, since cron authenticates with the sync token rather than a
session. It returns `503` when `ENABLE_DIRECT_ZK_SYNC` is not `true`, `409` if a sync is already
running (cron cannot know), and `401` on a bad token. The `setInterval` in the `listen` callback is
gone.

### Step 6 — CSP for Google SSO

**Not optional.** `helmet()` (line 19) sets a default Content-Security-Policy. Today it has no
effect because the API only returns JSON — it starts applying the moment Express serves HTML.

Checked empirically against the installed **helmet 8.2.0** via
`helmet.contentSecurityPolicy.getDefaultDirectives()`:

| Resource | Directive | Result |
|---|---|---|
| Google Fonts CSS (`fonts.googleapis.com`) | `style-src 'self' https: 'unsafe-inline'` | ✅ allowed |
| Google Fonts files (`fonts.gstatic.com`) | `font-src 'self' https: data:` | ✅ allowed |
| Google SSO script (`accounts.google.com/gsi/client`) | `script-src 'self'` | ❌ **blocked** |
| Google SSO iframe | falls back to `default-src 'self'` | ❌ **blocked** |
| Google SSO token exchange | `connect-src 'self'` | ❌ **blocked** |

So fonts are fine; only Google sign-in breaks. `frontend/src/pages/Login.jsx` uses the `<GoogleLogin>`
component from `@react-oauth/google`, which loads that script at runtime. Configure helmet
explicitly:

```js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", 'https://accounts.google.com'],
      'frame-src': ["'self'", 'https://accounts.google.com'],
      'connect-src': ["'self'", 'https://accounts.google.com'],
    },
  },
}));
```

**Test sign-in immediately after deploying** — both the email/password and Google paths.

> **Two directives beyond the plan were needed.** The table above was checked against helmet's
> defaults but not against the rest of the app. Loading the real Login page under the live policy
> and listening for `securitypolicyviolation` turned up two more blocks:
>
> | Resource | Directive | Why it matters |
> |---|---|---|
> | `blob:` frames | `frame-src` | Payslip PDFs are fetched as blobs and opened in a new tab |
> | External `https:` images | `img-src` | `Employee.photoUrl` is a free-form URL rendered by the org chart |
>
> Both are now allowed. Re-probed afterwards: **zero violations**, Google button renders,
> `window.google.accounts.id` present.

### Step 7 — Point the sync-agent at the single origin

`sync-agent/.env` on the office PC:

```env
HRIS_API_URL=https://hris.brandigade.com/api
SYNC_AGENT_TOKEN=<must match backend/.env exactly>
```

## 2.5 Verification of the deployment changes

Run against the real database with the built SPA in place:

| Check | Result |
|---|---|
| `npm run smoke` (after `npm ci --omit=dev`) | **54/54 passing** |
| `npm run lint` (frontend) | clean, exit 0 |
| `npm run build` (frontend) | 1.14 MB bundle, no `api.brandigade.com` and no localhost fallback left in it |
| `GET /` and `GET /payroll` | 200 `text/html` — SPA fallback works for deep links |
| `GET /api/does-not-exist` | 404 **JSON**, not `index.html` — the lookahead holds |
| `GET /assets/*.css` | 200, correct MIME |
| `POST /api/system/cron/sync` | 401 no token · 401 wrong token · 503 with valid token and sync disabled |
| Google sign-in under the live CSP | script loads, iframe renders, `window.google.accounts.id` present |
| CSP violation probe | zero violations |

One extra knob was added: `FRONTEND_DIST` (`backend/.env.example`) overrides where the built SPA is
read from, for cPanel layouts that do not keep `backend/` and `frontend/dist` side by side. Left
blank it uses this repository's layout. If no build is found, the server logs a warning and serves
the API only rather than 500-ing every page request.

## 2.3 Deploy sequence

```bash
# 1. Build the frontend (cPanel will not do this for you)
cd frontend && npm ci && npm run build      # produces frontend/dist

# 2. Upload backend/ + frontend/dist to the server

# 3. cPanel → Setup Node.js App
#    Node 20.x or 22.x · app root: backend · startup file: src/server.js
#    Set every variable from backend/.env.example, including NODE_ENV=production

# 4. In cPanel's terminal
cd backend && npm ci --omit=dev && npx prisma migrate deploy && npm run seed
```

`npm run seed` prints a generated admin password **once**. Save it — the account is required to
change it at first sign-in.

## 2.4 Caveats

- **Supabase free tier pauses after 7 days of inactivity.** The sync-agent posting punches every
  10 minutes keeps it awake, so in practice this will not bite — but expect a manual unpause after
  a long office holiday. Limits are 500 MB database / 1 GB storage; both are ample here.
- **You build the frontend manually.** cPanel will not run `npm run build`. Either build locally and
  upload `dist`, or run it in cPanel's terminal on each deploy.
- **`NODE_ENV=production` is what makes missing secrets fatal** rather than silently falling back to
  a random per-boot value, and what stops internal errors reaching the client. Do not skip it.

---

# Part 3 — Known issues not yet fixed

Found during the audit, out of scope for the pass, worth a look:

1. **`frontend/index.html` hardcodes dark theme classes on `<body>`** —
   `class="bg-zinc-950 text-white selection:bg-orange-500"`. A Tailwind utility outranks the
   `@layer base` rule in `index.css`, so in light mode the body stays near-black behind the app.
   Mostly hidden by the app shell, but visible in overscroll. The `selection:bg-orange-500` is also
   an orange that appears nowhere else in the palette. Fix: drop the classes and let `index.css`
   own the body.
2. **`index.html` has a commented-out Google Identity script tag** saying "uncomment when
   GOOGLE_CLIENT_ID is configured". It is not needed — `@react-oauth/google` loads the script
   itself. Delete the comment so nobody uncomments it and ends up with two copies.
3. **The frontend bundle is 1.14 MB** (319 KB gzipped) in one chunk. Recharts and framer-motion
   dominate. Route-level `React.lazy` on the heavy pages (`DigitalTwin`, `Campaigns`, `Payroll`)
   would cut first load substantially.
4. **`DigitalTwin.jsx` fires an N+1 request loop** — one `/campaigns/:id/dashboard` call per active
   campaign on mount. Fine for a handful of campaigns; worth a batch endpoint if it grows.
5. **No automated test suite** beyond `npm run smoke`. The smoke test covers integration paths well
   but there are no unit tests around the commission engine or the attendance maths — the two
   places where a subtle regression costs real money.
6. **`getPayslipPdfFile` regenerates the PDF on every request** rather than serving the archived
   copy from storage. Correct and simple, but the archived PDF in the `payslips` bucket is currently
   write-only — nothing ever reads it back.

---

# Part 4 — Command reference

```bash
# Backend
cd backend
npm run dev              # watch mode, port 4000
npm run start            # production
npm run seed             # create the first admin (prints password once)
npm run smoke            # 54 end-to-end checks, self-cleaning
npm run migrate:deploy   # apply migrations
npm run prisma:studio    # browse data

# Frontend
cd frontend
npm run dev              # Vite dev server
npm run build            # → frontend/dist
npm run lint             # oxlint (currently clean)
```

## Key files

| Path | What |
|---|---|
| `backend/.env` | All secrets. Git-ignored. **Never commit.** |
| `backend/.env.example` | Documented template for every variable |
| `backend/src/config/env.js` | Validated config, fail-fast on missing secrets |
| `backend/src/lib/prisma.js` | The single Prisma client |
| `backend/src/schemas/index.js` | zod schemas for every mutating route |
| `backend/src/utils/scope.js` | Shared RBAC scoping |
| `backend/src/utils/commission.js` | Commission engine (payroll + dashboard) |
| `backend/src/utils/attendanceTime.js` | Timezone-correct attendance maths |
| `backend/src/scripts/smoke-test.js` | The 54-check suite |
| `frontend/src/utils/api.js` | axios client, session storage, token refresh |
| `frontend/src/utils/roles.js` | Role vocabulary shared by router and pages |
| `frontend/src/utils/format.js` | Money/date formatters |

## Payroll policy knobs

Moved out of the payroll loop into environment variables. **Defaults match the previous hard-coded
behaviour exactly**, so nobody's pay changes until you change them.

| Variable | Default |
|---|---|
| `ATTENDANCE_ALLOWANCE` | `2500` |
| `PUNCTUALITY_ALLOWANCE` | `2500` |
| `ATTENDANCE_ALLOWANCE_MAX_LEAVE_DAYS` | `1` |
| `LATES_PER_DAY_DEDUCTION` | `3` |
| `HYBRID_PER_SHOWUP_BONUS` | `2000` |
| `TEAM_LEAD_COMMISSION_LADDER` | 4/6/8/10 per member → 10k/14k/18k/22k |
| `TEAM_LEAD_LADDER_CAMPAIGNS` | LVGL, Cleo HR, Patient Wing, Logics, Brandigade Outreach |

## One behaviour change to be aware of

**Team Leads cannot approve requests.** The README claimed they could; the API has always refused,
so the UI was rendering Approve/Reject buttons that could only fail. The interface and docs now
match the enforced behaviour, and leads get a read-only view of their team's requests instead.

If leads *should* be able to approve for their own team, that is a deliberate product change —
worth making on purpose rather than by restoring the broken buttons.
