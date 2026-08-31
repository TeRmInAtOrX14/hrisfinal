# Brandigade HRIS — open items and reference

Everything here is still live. The completed work that used to sit alongside this
(the security/correctness audit, and the single-origin deployment changes) is
recorded in the git history and no longer duplicated in a document.

---

# Deployment — in progress

The app is built, tested and packaged. It is **not live yet**, blocked on one
thing.

## The blocker

Namecheap shared hosting (`premium310-2.web-hosting.com`, 162.254.39.68) allows
outbound HTTPS but **blocks outbound PostgreSQL ports**. Verified from the
server itself: port 443 succeeds, 5432 and 6543 both time out. This is a host
firewall, not a configuration error — the databases involved are healthy and
reachable from other networks.

## What has been tried

| Attempt | Result |
|---|---|
| Supabase direct host `db.<ref>.supabase.co:5432` | Dead end — publishes an IPv6 address only, and the host has no IPv6 |
| Supabase session/transaction pooler (IPv4) | Correct fix for IPv6, but ports 5432/6543 are blocked |
| Prisma Accelerate as an HTTPS proxy | The `prisma platform` CLI that managed it has been removed from current Prisma |
| Prisma Postgres (`hris-production`, us-west-1) | Created, but the CLI only issues `postgres://pooled.db.prisma.io:5432` TCP URLs — same blocked port |

`src/lib/prisma.js` already selects its transport from the `DATABASE_URL`
prefix: `prisma://` or `prisma+postgres://` routes over HTTPS, anything else
connects directly. Verified that `@prisma/client` 5.22 accepts both HTTPS
prefixes — they reach the endpoint and return `P6002` for an invalid key — so
no Prisma upgrade is needed if an HTTPS connection string can be obtained.

## Open routes to resolve it

1. **Test whether the block is port-based or destination-based.** Run the
   reachability check against `pooled.db.prisma.io:5432`. If it is open, the
   Prisma Postgres TCP URL works as-is and this is solved.
2. **Get the `prisma+postgres://...?api_key=...` form from console.prisma.io.**
   The database has a connection named "Prisma Postgres API Key"; the CLI does
   not expose its value, but the web console may.
3. **Namecheap support.** They confirmed outbound 27017 (MongoDB) is open, so
   the platform does allow outbound database ports selectively. Worth pressing
   for 5432/6543.
4. **A VPS**, which removes the restriction entirely.

## Resources created

- Prisma project `hirs` (`proj_cmth9met5ak3wyoe3nkwrl5i0`), workspace "Personal workspace"
- Prisma Postgres database `hris-production` (`db_i5zq4gdyordy0rpbfk6iq35m`), us-west-1
- Supabase project `HRIS` (`ycnlcigdcuahqmlwoltz`), ap-northeast-1 — schema applied, **empty**,
  and still the store for payslip and document files regardless of where the tables end up

## Not blocked by any of the above

- `prisma migrate deploy` and `npm run seed` run from a machine with a normal
  connection, never from the host. The Supabase schema is already applied.
- Google sign-in still needs `https://hris.brandigade.com` added to the OAuth
  client's authorised JavaScript origins.
- The office sync agent needs `HRIS_API_URL=https://hris.brandigade.com/api`.
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
