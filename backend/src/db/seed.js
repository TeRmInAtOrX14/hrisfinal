const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  console.log('[Seed] Initializing production database environment...');

  const adminEmail = process.env.ADMIN_EMAIL || 'kashan.ahmed@brandigade.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Brandigade1';
  const adminName = process.env.ADMIN_NAME || 'Kashan Ahmed';

  // 1. Check if Super Admin account exists
  let adminUser = await prisma.user.findUnique({
    where: { email: adminEmail }
  });

  if (!adminUser) {
    console.log(`[Seed] Creating Super Admin account (${adminEmail})...`);
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(adminPassword, salt);

    adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        role: 'Admin',
        mustChangePassword: false
      }
    });

    await prisma.employee.create({
      data: {
        userId: adminUser.id,
        employeeCode: 'EMP-001',
        fullName: adminName,
        designation: 'Administrator',
        zkUserId: '1',
        status: 'active',
        baseSalary: 0,
        currency: 'PKR',
        shiftStart: process.env.OFFICE_START_TIME || '09:30',
        shiftEnd: '18:30'
      }
    });

    console.log(`[Seed] Super Admin created successfully.`);
  } else {
    console.log(`[Seed] Super Admin account (${adminEmail}) is already configured.`);
  }

  console.log('[Seed] Clean database state ready for real employee data import.');
}

main()
  .catch((e) => {
    console.error('[Seed] Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
