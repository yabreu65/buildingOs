const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function resetDailyLimit() {
  const today = new Date().toISOString().split('T')[0];
  const tenantId = 'cmoshktma00009auq4r31sthd';
  
  console.log(`Resetting AI daily limit for tenant ${tenantId} on ${today}...`);
  
  const result = await prisma.tenantDailyAiUsage.upsert({
    where: {
      tenantId_day: {
        tenantId,
        day: today,
      },
    },
    update: {
      count: 0,
    },
    create: {
      tenantId,
      day: today,
      count: 0,
    },
  });
  
  console.log('✅ Reset complete:', result);
  await prisma.$disconnect();
}

resetDailyLimit().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
