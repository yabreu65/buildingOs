import { BillingPlanId, Prisma, PrismaClient } from '@prisma/client';

type PlanInput = Omit<Prisma.BillingPlanCreateInput, 'planId'> & { planId: BillingPlanId };

export const LOCAL_PLANS: readonly PlanInput[] = [
  { planId: BillingPlanId.FREE, name: 'Free', description: 'Free tier for testing', monthlyPrice: 0, maxBuildings: 1, maxUnits: 10, maxUsers: 3, maxOccupants: 20, canExportReports: false, canBulkOperations: false, canUseAI: false, aiBudgetCents: 0, aiCallsMonthlyLimit: 0, aiAllowBigModel: false, aiConsultationsLimit: 0, supportLevel: 'COMMUNITY' },
  { planId: BillingPlanId.BASIC, name: 'Basic', description: 'Small buildings', monthlyPrice: 9900, maxBuildings: 3, maxUnits: 100, maxUsers: 10, maxOccupants: 200, canExportReports: true, canBulkOperations: false, canUseAI: true, aiBudgetCents: 200, aiCallsMonthlyLimit: 100, aiAllowBigModel: false, aiConsultationsLimit: 10, supportLevel: 'EMAIL' },
  { planId: BillingPlanId.PRO, name: 'Pro', description: 'Growing businesses', monthlyPrice: 29900, maxBuildings: 10, maxUnits: 500, maxUsers: 50, maxOccupants: 1000, canExportReports: true, canBulkOperations: true, canUseAI: true, aiBudgetCents: 800, aiCallsMonthlyLimit: 600, aiAllowBigModel: true, aiConsultationsLimit: 50, supportLevel: 'PRIORITY' },
  { planId: BillingPlanId.ENTERPRISE, name: 'Enterprise', description: 'Large scale deployments', monthlyPrice: 0, maxBuildings: 999, maxUnits: 9999, maxUsers: 999, maxOccupants: 99999, canExportReports: true, canBulkOperations: true, canUseAI: true, aiBudgetCents: 10000, aiCallsMonthlyLimit: 9999, aiAllowBigModel: true, aiConsultationsLimit: 999999, supportLevel: 'PRIORITY' },
];

export function validateLocalBillingEnvironment(env: NodeJS.ProcessEnv): void {
  if (!['', 'development', 'test'].includes(env.NODE_ENV ?? '')) throw new Error('NODE_ENV must be local');
  if (!env.DATABASE_URL?.startsWith('postgresql://')) throw new Error('DATABASE_URL must use PostgreSQL');
  const url = new URL(env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw new Error('DATABASE_URL host must be local');
  const database = url.pathname.replace(/^\//, '');
  if (database !== 'buildingos' || /staging|production|prod/i.test(database)) throw new Error('DATABASE_URL database must be buildingos');
}

export interface BillingPlanClient {
  billingPlan: { findMany(): Promise<Array<{ planId: BillingPlanId; maxUsers: number }>>; upsert(args: { where: { planId: BillingPlanId }; create: PlanInput; update: Prisma.BillingPlanUpdateInput }): Promise<unknown> };
  $transaction<T>(fn: (tx: BillingPlanClient) => Promise<T>): Promise<T>;
}

export async function synchronizeBillingPlans(client: BillingPlanClient, apply: boolean) {
  const existing = await client.billingPlan.findMany();
  const byId = new Map(existing.map((plan) => [plan.planId, plan]));
  const missing = LOCAL_PLANS.filter((plan) => !byId.has(plan.planId)).map((plan) => plan.planId);
  const preserved = LOCAL_PLANS.filter((plan) => byId.has(plan.planId) && plan.planId === BillingPlanId.FREE && byId.get(plan.planId)!.maxUsers >= 3).map((plan) => plan.planId);
  if (!apply) return { existing: existing.map((plan) => plan.planId), missing, preserved };
  await client.$transaction(async (tx) => {
    for (const plan of LOCAL_PLANS) {
      const current = byId.get(plan.planId);
      const update: Prisma.BillingPlanUpdateInput = { ...plan, maxUsers: plan.planId === BillingPlanId.FREE ? Math.max(current?.maxUsers ?? 3, 3) : plan.maxUsers };
      await tx.billingPlan.upsert({ where: { planId: plan.planId }, create: plan, update });
    }
  });
  return { existing: existing.map((plan) => plan.planId), missing, preserved };
}

async function main() {
  validateLocalBillingEnvironment(process.env);
  const prisma = new PrismaClient();
  try {
    const apply = process.argv.includes('--apply');
    const result = await synchronizeBillingPlans(prisma as unknown as BillingPlanClient, apply);
    console.log(`PLANES_EXISTENTES=${result.existing.join(',') || 'NINGUNO'}`);
    console.log(`PLANES_FALTANTES=${result.missing.join(',') || 'NINGUNO'}`);
    console.log(`PLANES_A_CONSERVAR=${result.preserved.join(',') || 'NINGUNO'}`);
    console.log(`MODO=${apply ? 'APPLY' : 'DIAGNOSTICO'}`);
    console.log(`DATOS_MODIFICADOS=${apply ? 'SI' : 'NO'}`);
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
