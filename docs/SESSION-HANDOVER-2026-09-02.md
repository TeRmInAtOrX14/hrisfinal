# Session handover — 2026-09-02

Everything done in this working session, why, and how to verify or roll it back.
Three bodies of work, in order:

1. **Google sign-in lockout + RBAC + admin password reset** — committed `531d0b9`, deployed.
2. **Full security & correctness audit** — 59 findings, published as an artifact.
3. **Four critical fixes + two new features + a review pass** — committed and pushed
   (one commit: "Stop the silent payroll losses, and open performance entry to leads and SDRs").

---

## Part 1 — Google sign-in, RBAC, admin reset (`531d0b9`, deployed)

**Ask:** "SDRs cannot login via google signin, the whitelisting is done btw, and make
sure we have correct RBAC and SDRs credentials should be resettable by the admin."

- **Google sign-in error was masked.** `frontend/src/utils/api.js` — the axios 401
  interceptor exempted `/auth/login` and `/auth/refresh` from its "session expired"
  handling but **not** `/auth/google-login`. Every rejected Google sign-in triggered a
  doomed refresh and a reload to `/login?reason=session-expired`, hiding the real error.
  Fixed by listing all three no-session endpoints explicitly.
- **Admin password reset had no UI.** The backend endpoint existed; nothing called it.
  Added a **Reset Password** action to the employee drawer in
  `frontend/src/pages/Employees.jsx` with a one-time-credential modal + copy button.
- **RBAC gap:** Team Leads were served `baseSalary`/`bankAccount` on team members' rows.
  Added `redactCompensation()` in `backend/src/controllers/employee.js`.

**Ops items still open (not code):**
- Deactivated SDR logins with active employee records: `arhambrandigade1@gmail.com`
  (EMP-1006), `emaazbrandigade@gmail.com` (EMP-1004). Re-enable via "Login Status" if
  unintended.
- If SDRs still fail *after* the Google account picker, check the OAuth consent screen's
  **publishing status** in Google Cloud Console ("Testing" blocks non-test users).

---

## Part 2 — Full audit (artifact published, nothing changed by it)

Five parallel subsystem reviews plus a dependency + secrets sweep. **59 findings**:
5 Critical, 17 High, 24 Medium, 13 Low. Published privately as **Brandigade HRIS Audit**:
`https://claude.ai/code/artifact/5f723cfc-c9c3-4d47-9032-3dbf19f97e6e`

Dependency advisories: backend `ip-address`/`body-parser` (transitive), frontend
`react-router` 7.x CSRF (RSC-mode only). Run `npm audit fix` both sides when convenient.
No secrets are committed to git (verified).

---

## Part 3 — Four critical fixes + two features (committed, pushed, deployed)

Requested: "skip 1, fix the other 4" of the audit's fix-first list, plus:
- Team Leads input campaign performance for themselves and their team members.
- Employees/SDRs enter their own "meetings scheduled" and "show-ups" so commission is
  calculated automatically.

Then: "review the changes, are they solid? … make it 100% ready then push it."

**Item 1 (rotate the committed `Brandigade2026!` password + delete the two seed scripts)
was intentionally skipped** — an ops/credentials task for the team. It remains the single
most urgent outstanding item. Scripts: `backend/src/scripts/create-admin-accounts.js`,
`backend/src/scripts/import-biometric-users.js`.

### Files changed

| File | Change |
|---|---|
| `backend/src/controllers/payroll.js` | C5 finalize re-check inside txn; C2 merge comment |
| `backend/src/controllers/campaign.js` | C3 slab-wipe guard; scoped performance auth; `teamLeadPerformance` on dashboard |
| `backend/src/controllers/employee.js` | C4 delete guard |
| `backend/src/schemas/index.js` | C3 `slabs` optional (no default); C2 `runMetric`/`runMoney` |
| `backend/src/routes/campaign.js` | performance route de-gated (auth lives in controller) |
| `backend/test/payroll-run-schema.test.js` | **new** — locks in the C2/C3 schema contracts |
| `frontend/src/pages/Payroll.jsx` | C2 blank-means-logged contract; integer coercion |
| `frontend/src/pages/Employees.jsx` | delete confirm copy matches the new guard |
| `frontend/src/pages/SDRDashboard.jsx` | Feature 2 — SDR self-service metric entry |
| `frontend/src/pages/TeamLeadDashboard.jsx` | Feature 1 — editable roster + lead's own row |

### Fix C2 — payroll no longer pays commission on zero show-ups

**Bug:** the run modal seeded every employee's metrics to `0` and always posted them. The
backend merge `override?.showups ?? stored?.showups ?? 0` treats `0` as a real value, so
the modal's default beat the logged `CampaignPerformance`. Commission was paid on zero
unless an admin re-typed every number.

**Root cause was the client contract, not the merge.** `??` is correct *if* an untouched
field arrives as "not provided" rather than `0`.

**Fix:**
- `schemas/index.js` — `runMetric`/`runMoney` preprocessors normalise `''`/`null` to
  `undefined` for the performance fields. A real number (including a deliberate `0`) is an
  override. Verified against installed zod 4.4.3.
- `Payroll.jsx` — defaults start **blank**; blank fields are sent as `null`; a `logged`
  placeholder and an explanatory note appear in the modal. Count fields are truncated to
  integers before sending (the API rejects decimals for counts).
- `payroll.js` — comment at the merge documenting the contract; logic unchanged.

**Net behavior:** logged `CampaignPerformance` is the source of truth for pay; the run
modal only overrides what the admin actually types. This is what makes Features 1 & 2
meaningful — entered numbers now actually reach payroll.

### Fix C3 — renaming a commission structure no longer wipes its slabs

`slabs` is now `.optional()` **without** a default. `updateStructure` only touches the
slab table when `slabs` is actually sent; an active structure must keep at least one slab
(mirrors `activateStructure`). `createStructure` defaults to `[]` locally. The Campaigns
page always sends `slabs`, so its behaviour is unchanged except that emptying the bands on
an active structure now returns a clear 400 instead of silently zeroing commission.

### Fix C4 — permanent employee delete can no longer destroy payroll history

Before the delete transaction, `deleteEmployee` counts payslips, attendance rows, and
spiffs-given. Any history → 409 directing the admin to **Terminate**. Permanent delete
remains only for no-history mistake accounts. A guard, not a migration — deliberately
minimal. The UI confirm text now says exactly this.

### Fix C5 — a finalized run can no longer be reverted by a concurrent run

The run is re-read **inside** the `$transaction`; if finalized, a tagged error is thrown
and mapped to a clean 409 (`PAYROLL_ALREADY_FINALIZED`). A sub-millisecond residual race
remains (finalize committing between the re-read and the write) — acceptable for a
single-instance deployment; a `SELECT … FOR UPDATE` would be the belt-and-braces version.

### Feature 1 — Team Leads enter performance for their team (and themselves)

- `routes/campaign.js` — `requireRole(ADMIN)` removed from `POST /performance`.
- `campaign.js` `logPerformance` — scoped authorization: Admin/CEO/COO → anyone; **Team
  Lead** → any active member of a campaign they lead (`ledCampaignIds`), themselves
  included; SDR/Employee → own record only. Membership must be **active** (was: any).
- `campaign.js` `getCampaignDashboard` — returns `campaign.teamLeadPerformance` (the
  lead's own logged row) so the UI can seed a self-entry form. It is **not** part of
  `leaderboard`/`stats`, and payroll's team total sums SDR-role rows only, so a lead
  logging their own numbers cannot inflate their ladder payout. Verified in `payroll.js`.
- `TeamLeadDashboard.jsx` — the roster is editable (Booked / Show-ups inputs + Save per
  row), seeded from logged figures, with a final **"You — Team Lead"** row for the lead's
  own metrics. Saving refetches the dashboard; reseeding is merge-preserving so unsaved
  edits in other rows survive.

### Feature 2 — SDRs/Employees enter their own meetings + show-ups

- Same `logPerformance` change (self-only branch).
- `SDRDashboard.jsx` — "Log my metrics" card (shown with an active campaign), seeded from
  this month's logged figures, posting to `/campaigns/performance` and refreshing the
  commission view.

Both entry points enforce: whole numbers, non-negative, show-ups no greater than meetings.

> **Control tradeoff:** self-entered show-ups feed commission directly (as requested), so
> an SDR can influence their own pay. Oversight today: every entry is audit-logged
> (`LOG_CAMPAIGN_PERFORMANCE` with the acting user); a Team Lead/admin can see and correct
> any figure in the roster or override it in the payroll run modal before finalizing. If a
> harder control is wanted, add a review/lock step before payroll consumes the numbers —
> flagged for a product decision, not built.

### Review pass (before push)

A line-by-line re-read of the whole diff found five gaps, all fixed:
1. Decimals in a count box (e.g. `5.5`) would 400 with "expected int" — all three forms
   now truncate to integers client-side.
2. Leads had no UI to log **their own** metrics despite the ask — added the lead row
   (needed the small `teamLeadPerformance` addition to the dashboard response).
3. Saving one roster row wiped unsaved edits in the others — reseeding is now a merge.
4. The delete confirm still promised a hard delete the API now refuses — copy updated.
5. Nothing locked in the C2/C3 contracts — `backend/test/payroll-run-schema.test.js`
   added (4 tests).

Also confirmed: hook ordering is valid in both dashboards; the dashboard payload carries
the exact field names the seeds read; the only callers of `/campaigns/performance` are
the two new ones (there was previously **no** UI to log performance at all).

## Verification

- Backend: **30/30 tests pass** (`cd backend && npm test`); all changed modules load.
- Frontend: **lint clean**, **build succeeds**.
- No smoke/integration run against the database — `npm run smoke` writes to the
  **production** DB (the local `.env` points at prod), so it was left for the team to run
  deliberately.
- Deployed via the CI pipeline on push to `main`; health check verified after deploy.

## Still open

- **Item 1 — rotate `Brandigade2026!`, delete the two seed scripts.** Most urgent.
- Admins have no UI to log `CampaignPerformance` directly (only Team Leads and SDRs do);
  admins can still override at payroll time. A small follow-up if wanted.
- The remaining 50+ audit findings (High/Medium/Low) — see the audit artifact.
- Live database password state for the admin accounts could not be verified from this
  session. Rotate regardless.
