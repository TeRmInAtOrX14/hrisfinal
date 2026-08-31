const { PrismaClient } = require('@prisma/client');

/**
 * Single shared PrismaClient for the whole process.
 *
 * Every module previously constructed its own `new PrismaClient()`, which meant
 * ~13 independent connection pools against the same Supabase pooler. Sharing one
 * client keeps the connection count predictable and lets `$transaction` behave.
 *
 * The global cache keeps `node --watch` restarts from leaking clients in dev.
 */
const globalForPrisma = globalThis;

/**
 * Transport selection.
 *
 * Shared hosting (Namecheap cPanel, and most others) permits outbound HTTPS but
 * blocks outbound PostgreSQL ports — 5432 and 6543 both time out, while 443 is
 * fine. A `prisma://` connection string routes queries through Prisma Accelerate
 * over 443 instead, which is the only way this app can reach its database from
 * such a host.
 *
 * Everywhere else — local development, and `prisma migrate` / `npm run seed`,
 * which are run from a machine that can open a real connection — the URL stays
 * `postgresql://` and the client talks to Postgres directly. One build serves
 * both; the URL alone decides.
 */
const url = process.env.DATABASE_URL || '';
const usingAccelerate = url.startsWith('prisma://') || url.startsWith('prisma+postgres://');

function createClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

  if (!usingAccelerate) return client;

  // Required only on the Accelerate path, so it is not a hard dependency of
  // running this app against a directly reachable database.
  const { withAccelerate } = require('@prisma/extension-accelerate');
  return client.$extends(withAccelerate());
}

const prisma = globalForPrisma.__brandigadePrisma || createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__brandigadePrisma = prisma;
}

module.exports = prisma;
