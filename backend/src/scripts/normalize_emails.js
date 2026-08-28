const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });

  let fixed = 0;
  for (const user of users) {
    const lower = user.email.toLowerCase();
    if (lower !== user.email) {
      await prisma.user.update({
        where: { id: user.id },
        data: { email: lower }
      });
      console.log(`Fixed: "${user.email}" → "${lower}"`);
      fixed++;
    }
  }

  console.log(`\nDone. Normalised ${fixed} of ${users.length} emails to lowercase.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
