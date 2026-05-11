process.env.DATABASE_URL = 'postgresql://buildingos:buildingos@172.19.0.4:5432/buildingos?schema=public';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    const count = await prisma.tenant.count();
    console.log('✅ DB Connected! Tenants:', count);
    await prisma.$disconnect();
  } catch (e) {
    console.error('❌ DB Error:', e.message);
    process.exit(1);
  }
}

test();
