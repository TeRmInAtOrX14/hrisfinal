# Deployment

Pushing to `main` deploys. The workflow in `.github/workflows/deploy.yml` runs
the tests, builds the front end, applies any pending migrations, ships the files
to cPanel, restarts the app, and fails loudly if the health check does not come
back clean.

There is nothing to zip and nothing to upload by hand.

---

## What runs where, and why

| Step | Where | Why not on the server |
|---|---|---|
| Unit tests, lint | GitHub runner | — |
| `npm run build` | GitHub runner | cPanel has no build step, and installing Vite on shared hosting is slow and pointless |
| `prisma migrate deploy` | GitHub runner | **Namecheap blocks outbound PostgreSQL.** The app server cannot open a migration connection; a runner can |
| `npm ci --omit=dev` | cPanel | Native modules and the Prisma query engine must be built for the server's own platform |
| Passenger restart | cPanel | `touch tmp/restart.txt` is how CloudLinux picks up new code |

The app reaches its database over HTTPS at runtime (`prisma+postgres://`), which
is why it works on a host that blocks 5432. See `NOTES.md`.

---

## One-time setup

### 1. Enable SSH on the cPanel account

**cPanel → SSH Access → Manage SSH Keys.** Generate a key (or import one), then
**Authorize** it. Keep the private key — it goes into GitHub in step 3.

If SSH is not available on the plan, open a ticket with Namecheap to enable it.
Without SSH this workflow cannot install dependencies or restart the app.

### 2. Confirm the paths

In **Setup Node.js App**, the page for the app shows a command starting
`source ...`. You need two values from it:

- the **activate script** path, e.g.
  `/home/brandcto/nodevenv/hris/backend/24/bin/activate`
- the **application path**, e.g. `/home/brandcto/hris`

### 3. Add the repository secrets

**GitHub → Settings → Secrets and variables → Actions → Secrets:**

| Secret | Value |
|---|---|
| `CPANEL_HOST` | `premium310-2.web-hosting.com` |
| `CPANEL_USER` | `brandcto` |
| `CPANEL_SSH_PORT` | usually `21098` on Namecheap, not 22 |
| `CPANEL_SSH_KEY` | the **private** key from step 1, whole file including the BEGIN/END lines |
| `DIRECT_URL` | the `postgres://…@db.prisma.io:5432/…` string from `backend/.env` |

`DIRECT_URL` is the TCP form on purpose: migrations need a real connection, and
the runner is not firewalled. If you leave it unset the migration job skips
itself and the rest of the deploy still runs.

### 4. Add the repository variables

Same page, **Variables** tab. These are not secrets and are visible in logs:

| Variable | Value |
|---|---|
| `CPANEL_APP_PATH` | `/home/brandcto/hris` |
| `CPANEL_NODEVENV_ACTIVATE` | `/home/brandcto/nodevenv/hris/backend/24/bin/activate` |
| `APP_HOST` | `hris.brandigade.com` |

### 5. Trigger it

Push to `main`, or use **Actions → Deploy → Run workflow**.

---

## What the deploy will and will not touch

Each `rsync` targets a single directory and deletes only inside it:

- `backend/src/` — replaced
- `backend/prisma/` — replaced
- `backend/package.json`, `backend/package-lock.json` — replaced
- `frontend/dist/` — replaced

**Never touched:** `backend/.env`, `backend/node_modules`, `backend/tmp`, and
anything else in the home directory. The secrets on the server survive every
deploy, which is why they are not in the repository.

---

## If SSH is not available

`.cpanel.yml` in the repository root supports cPanel's built-in **Git Version
Control**: clone the repo there once, then press **Deploy HEAD Commit** after
each push. It copies `backend/src` and `backend/prisma` into place and restarts.

Two caveats, so this is a fallback rather than the main path:

- It **cannot build the front end** — cPanel has no build step. Any front-end
  change still needs `npm run build` locally and `frontend/dist` uploaded.
- It **cannot run migrations**, for the same outbound-port reason. Run
  `npx prisma migrate deploy` from your own machine.

---

## Rolling back

Revert the commit and push. The workflow redeploys the previous state.

A migration is not undone by a revert. If a bad migration ships, write a new
migration that corrects it — do not attempt to roll the database backwards.
