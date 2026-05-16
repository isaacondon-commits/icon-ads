const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('admin1234', 10);
  const user = await prisma.user.upsert({
    where: { email: 'admin@iconads.com' },
    update: {},
    create: { email: 'admin@iconads.com', password, name: 'Admin' },
  });
  console.log(`Seed complete — user: ${user.email}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
