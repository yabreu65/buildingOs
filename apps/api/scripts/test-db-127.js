process.env.DATABASE_URL = 'postgresql://buildingos:buildingos@127.0.0.1:5434/buildingos?schema=public';
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
