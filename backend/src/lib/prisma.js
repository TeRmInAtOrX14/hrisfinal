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

const prisma =
  globalForPrisma.__brandigadePrisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__brandigadePrisma = prisma;
}

module.exports = prisma;
