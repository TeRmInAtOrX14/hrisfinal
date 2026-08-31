# Brandigade HRIS — open items and reference

Everything here is still live. The completed work that used to sit alongside this
(the security/correctness audit, and the single-origin deployment changes) is
recorded in the git history and no longer duplicated in a document.

---

# Deployment

The app is packaged and ready to upload. The database connection problem that
held this up is **resolved**.

## The constraint

Namecheap shared hosting (`premium310-2.web-hosting.com`) permits outbound HTTPS
but blocks outbound PostgreSQL. Verified on the server itself: port 443
succeeds, while port 5432 times out to Supabase *and* to Prisma — two unrelated
providers in different IP ranges. It is port-based filtering, so no choice of
database provider gets around it over TCP.

## The resolution

The database moved to **Prisma Postgres** (`hris-production`, us-west-1),
reached over HTTPS on port 443:

| Variable | Form | Used by |
|---|---|---|
| `DATABASE_URL` | `prisma+postgres://accelerate.prisma-data.net/?api_key=…` | the app on cPanel |
| `DIRECT_URL` | `postgres://…@db.prisma.io:5432/…` | `prisma migrate` and `npm run seed`, run locally |

`src/lib/prisma.js` selects the transport from the URL prefix, so one build
serves both. The full smoke suite passes **54/54 over the HTTPS transport**.

Supabase remains, but only as **file storage** for payslip PDFs and employee
documents — that is HTTPS and unaffected. Its Postgres database is now unused.

## Dead ends, recorded so they are not retried

| Attempt | Why it failed |
|---|---|
| Supabase direct host `db.<ref>.supabase.co:5432` | Publishes an IPv6 address only; the host has no IPv6 |
| Supabase session and transaction poolers | IPv4, but ports 5432/6543 are blocked |
| Prisma Accelerate in front of Supabase | The `prisma platform` CLI that managed it was removed from current Prisma |
| `prisma postgres create` / `connection create` | Only ever issue TCP URLs on port 5432 |
| `prisma+postgres://db.prisma.io/?api_key=…` | Returns 404 — the HTTPS host is `accelerate.prisma-data.net` |

The HTTPS connection string is not exposed by the CLI at all. It comes from
console.prisma.io, under the database's connection strings.

## Still to do

- **Rotate the Prisma Postgres credentials.** They were pasted into a chat
  transcript during setup. Use `prisma postgres connection rotate`, then update
  `backend/.env` and redeploy.
- Add `https://hris.brandigade.com` to the Google OAuth client's authorised
  JavaScript origins, or Google sign-in fails.
- Point the office sync agent at `https://hris.brandigade.com/api`.
- Delete the unused Supabase database, and the first Prisma Postgres database
  created by mistake during setup.
- Email is disabled — `SMTP_*` is blank, so nothing is sent. In-app
  notifications work.

---

# Known issues not yet fixed

Found during the audit, deliberately left out of scope. None of these block the deploy.

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

# Command reference

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
