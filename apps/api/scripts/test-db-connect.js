process.env.DATABASE_URL = 'postgresql://buildingos:buildingos@127.0.0.1:5434/buildingos?schema=public';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

async function test() {
  try {
    // Try with explicit connection parameters to reduce pool size
    await prisma.$connect();
    console.log('✅ $connect() succeeded');
    const count = await prisma.tenant.count();
    console.log('✅ DB Connected! Tenants:', count);
    await prisma.$disconnect();
  } catch (e) {
    console.error('❌ DB Error:', e.message);
    console.error('Code:', e.code);
    process.exit(1);
  }
}

test();
