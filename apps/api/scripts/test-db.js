const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    const count = await prisma.tenant.count();
    console.log('✅ DB Connected! Tenants:', count);
    const tenant = await prisma.tenant.findFirst({
      where: { name: 'Residencia San Cristóbal' }
    });
    console.log('San Cristóbal:', tenant ? 'FOUND' : 'NOT FOUND');
    await prisma.$disconnect();
  } catch (e) {
    console.error('❌ DB Error:', e.message);
    process.exit(1);
  }
}

test();
