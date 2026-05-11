const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  const tenant = await prisma.tenant.findFirst({ where: { name: 'Residencia San Cristóbal' } });
  if (!tenant) { console.log('Tenant not found'); return; }
  
  // Find or create a PRO plan
  let plan = await prisma.billingPlan.findFirst({ where: { planId: 'PRO' } });
  if (!plan) {
    plan = await prisma.billingPlan.create({
      data: {
        planId: 'PRO',
        name: 'Pro',
        monthlyPrice: 29900,
        maxBuildings: 10,
        maxUnits: 500,
        maxUsers: 50,
        maxOccupants: 1000,
        canUseAI: true,
        aiBudgetCents: 800,
        aiCallsMonthlyLimit: 600,
        aiAllowBigModel: true,
        aiConsultationsLimit: 50,
        supportLevel: 'PRIORITY',
      }
    });
    console.log('Created PRO plan');
  }
  
  // Update subscription
  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    update: { planId: plan.id, status: 'ACTIVE' },
    create: {
      tenantId: tenant.id,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }
  });
  
  console.log('✅ AI enabled for San Cristóbal');
  await prisma.$disconnect();
}

fix().catch(e => { console.error(e); process.exit(1); });
