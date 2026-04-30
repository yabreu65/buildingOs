import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) {
    console.error('Usage: TENANT_ID=xxx npm run tenant:enable-ai');
    console.error('Example: TENANT_ID=cmofollqo0000nzbytbeut1m7 npm run tenant:enable-ai');
    process.exit(1);
  }

  console.log(`[INFO] Enabling AI for tenant: ${tenantId}`);

  // Check tenant exists
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    console.error(`[ERROR] Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  // Find plan with canUseAI=true (any plan that enables AI)
  const aiPlan = await prisma.billingPlan.findFirst({
    where: { canUseAI: true },
    orderBy: { aiConsultationsLimit: 'desc' }, // Prefer plan with more AI credits
  });

  if (!aiPlan) {
    console.error(`[ERROR] No plan with canUseAI=true found`);
    process.exit(1);
  }

  console.log(`[INFO] Using plan: ${aiPlan.name} (${aiPlan.id})`);

  // Upsert subscription - use plan.id as FK (not planId enum)
  const sub = await prisma.subscription.upsert({
    where: { tenantId },
    update: { planId: aiPlan.id, status: 'ACTIVE' },
    create: {
      tenantId,
      planId: aiPlan.id,
      status: 'ACTIVE',
    },
  });

  console.log(`\n✅ AI enabled successfully!`);
  console.log(`   Tenant: ${tenant.name} (${tenantId})`);
  console.log(`   Subscription ID: ${sub.id}`);
  console.log(`   Plan ID: ${aiPlan.id}`);
  console.log(`   Plan Name: ${aiPlan.name}`);
  console.log(`   canUseAI: ${aiPlan.canUseAI}`);
  console.log(`   aiConsultationsLimit: ${aiPlan.aiConsultationsLimit}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[ERROR]', e);
  process.exit(1);
});