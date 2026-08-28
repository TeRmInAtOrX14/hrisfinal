require('dotenv').config();

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = require('../lib/prisma');

/**
 * Bootstrap the first administrator account.
 *
 * The previous version fell back to a hard-coded password ('Brandigade1') and
 * set `mustChangePassword: false`, so a fresh deployment shipped with a known
 * admin credential that the system never asked anyone to change. If
 * ADMIN_PASSWORD is not set we now generate a strong random one, print it once,
 * and require it to be changed at first sign-in.
 */
async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const name = process.env.ADMIN_NAME || 'System Administrator';

  if (!email) {
    console.error('[Seed] ADMIN_EMAIL is required. Set it in backend/.env and run again.');
    process.exit(1);
  }

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });

  if (existing) {
    console.log(`[Seed] Administrator ${email} already exists — nothing to do.`);
    return;
  }

  const provided = process.env.ADMIN_PASSWORD;
  const generated = !provided;
  // Base64url of 18 bytes: 24 characters, satisfies the password policy.
  const password = provided || crypto.randomBytes(18).toString('base64url');

  const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(12));

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        role: 'Admin',
        // Even an operator-chosen password must be replaced by the human who
        // will actually use the account.
        mustChangePassword: true,
      },
    });

    await tx.employee.create({
      data: {
        userId: user.id,
        employeeCode: process.env.ADMIN_EMPLOYEE_CODE || 'EMP-001',
        fullName: name,
        designation: 'Administrator',
        status: 'active',
        baseSalary: 0,
        currency: 'PKR',
        shiftStart: process.env.OFFICE_START_TIME || '09:30',
        shiftEnd: process.env.OFFICE_END_TIME || '18:30',
      },
    });
  });

  console.log('\n' + '='.repeat(64));
  console.log('[Seed] Administrator account created.');
  console.log(`       Email:    ${email}`);
  if (generated) {
    console.log(`       Password: ${password}`);
    console.log('\n       This password is shown once and is not stored anywhere else.');
  } else {
    console.log('       Password: (the ADMIN_PASSWORD you configured)');
  }
  console.log('       You will be asked to change it at first sign-in.');
  console.log('='.repeat(64) + '\n');
}

main()
  .catch((err) => {
    console.error('[Seed] Failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
