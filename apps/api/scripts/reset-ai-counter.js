const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function reset() {
  const tenant = await prisma.tenant.findFirst({
    where: { name: 'Residencia San Cristóbal' }
  });
  
  if (!tenant) {
    console.log('Tenant not found');
    return;
  }

  // Reset AI consultation counter in subscription
  const result = await prisma.subscription.updateMany({
    where: { tenantId: tenant.id },
    data: { 
      aiConsultationsUsed: 0,
      aiConsultationsResetAt: new Date()
    }
  });

  console.log(`✅ Reset ${result.count} subscription(s) for San Cristóbal`);
  
  // Also update plan to have unlimited consultations for testing
  const plan = await prisma.billingPlan.findFirst({
    where: { planId: 'PRO' }
  });
  
  if (plan) {
    await prisma.billingPlan.update({
      where: { id: plan.id },
      data: { aiConsultationsLimit: 999999 }
    });
    console.log('✅ Updated PRO plan to unlimited consultations');
  }

  await prisma.$disconnect();
}

reset().catch(e => { console.error(e); process.exit(1); });
