process.env.DATABASE_URL = 'postgresql://buildingos:buildingos@127.0.0.1:5434/buildingos?schema=public&connect_timeout=5&pool_timeout=5';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

async function test() {
  try {
    const count = await prisma.tenant.count();
    console.log('✅ DB Connected! Tenants:', count);
    await prisma.$disconnect();
  } catch (e) {
    console.error('❌ DB Error:', e.message);
    console.error('Code:', e.code);
    console.error('Meta:', e.meta);
    if (e.cause) console.error('Cause:', e.cause);
    process.exit(1);
  }
}

test();
