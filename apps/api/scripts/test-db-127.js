process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL or TEST_DATABASE_URL is required');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    const count = await prisma.tenant.count();
    console.log('✅ DB Connected! Tenants:', count);
    const tenant = await prisma.tenant.findFirst({
      where: { name: 'Residencia San Cristóbal' }
    });
    console.log('San Cristóbal:', tenant ? 'FOUND - ' + tenant.id : 'NOT FOUND');
    await prisma.$disconnect();
  } catch (e) {
    console.error('❌ DB Error:', e.message);
    process.exit(1);
  }
}

test();
