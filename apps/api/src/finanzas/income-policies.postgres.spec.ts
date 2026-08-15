import {
  IncomeApplicationDestination,
  IncomeStatus,
  PrismaClient,
  TenantType,
} from '@prisma/client';
import { BadRequestException as NestBadRequestException, ConflictException as NestConflictException } from '@nestjs/common';
import { IncomePoliciesService } from './income-policies.service';
import { IncomeApplicationsService } from './income-applications.service';
import { FundsService } from './funds.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { PrismaService } from '../prisma/prisma.service';

const ACCEPTANCE_DATABASES = new Set(['buildingos_fin05_acceptance']);
const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
const fixturePhase = 'fin05';
const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  expectedDatabaseName !== undefined &&
  ACCEPTANCE_DATABASES.has(expectedDatabaseName);
const describePostgres = enabled ? describe : describe.skip;

describePostgres('IncomePolicies PostgreSQL (FIN-05)', () => {
  let observer: PrismaClient;
  let clientA: PrismaClient;
  let clientB: PrismaClient;
  let policies: IncomePoliciesService;
  let apps: IncomeApplicationsService;
  let funds: FundsService;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const membershipIds: string[] = [];

  function buildServices(client: PrismaClient) {
    const prisma = client as unknown as PrismaService;
    const audit = new AuditService(prisma);
    const validators = new FinanzasValidators(prisma);
    return {
      policies: new IncomePoliciesService(prisma, audit, validators),
      apps: new IncomeApplicationsService(prisma, audit, validators),
      funds: new FundsService(prisma, audit, validators),
    };
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    observer = new PrismaClient();
    clientA = new PrismaClient();
    clientB = new PrismaClient();
    await Promise.all([observer.$connect(), clientA.$connect(), clientB.$connect()]);
    const [database] = await observer.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (database?.name !== expectedDatabaseName || !ACCEPTANCE_DATABASES.has(database.name)) {
      throw new Error(`Refusing destructive test database ${database?.name ?? 'unknown'}`);
    }
    const svcA = buildServices(clientA);
    policies = svcA.policies;
    apps = svcA.apps;
    funds = svcA.funds;

    // Limpieza defensiva de fixtures de corridas previas interrumpidas.
    await observer.tenant.deleteMany({ where: { name: { startsWith: `${fixturePhase}-` } } });
  });

  afterEach(async () => {
    for (const membershipId of membershipIds.splice(0)) {
      await observer.membership.delete({ where: { id: membershipId } }).catch(() => undefined);
    }
    for (const tenantId of tenantIds.splice(0)) {
      await observer.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    for (const userId of userIds.splice(0)) {
      await observer.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  });

  afterAll(async () => {
    await Promise.all([
      observer?.$disconnect(),
      clientA?.$disconnect(),
      clientB?.$disconnect(),
    ]);
  });

  async function fixture(label: string) {
    const suffix = `${Date.now()}-${Math.random()}`;
    const tenant = await observer.tenant.create({
      data: { name: `${fixturePhase}-${label}-${suffix}`, type: TenantType.ADMINISTRADORA },
    });
    tenantIds.push(tenant.id);
    const user = await observer.user.create({
      data: { email: `${fixturePhase}-${suffix}@buildingos.local`, name: `${fixturePhase} ${label}`, passwordHash: 'test' },
    });
    userIds.push(user.id);
    const membership = await observer.membership.create({ data: { tenantId: tenant.id, userId: user.id } });
    membershipIds.push(membership.id);
    return { tenant, membership };
  }

  async function incomeCategory(tenantId: string) {
    return observer.expenseLedgerCategory.create({
      data: { tenantId, name: `Income Cat ${Date.now()}`, movementType: 'INCOME' },
    });
  }

  async function fund(tenantId: string, membershipId: string) {
    return observer.fund.create({
      data: { tenantId, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}-${Math.random()}`, createdByMembershipId: membershipId },
    });
  }

  async function recordedIncome(tenantId: string, membershipId: string, categoryId: string, amountMinor = 10000) {
    return observer.income.create({
      data: {
        tenantId,
        period: '2026-08',
        categoryId,
        amountMinor,
        currencyCode: 'USD',
        receivedDate: new Date('2026-08-10T00:00:00.000Z'),
        status: IncomeStatus.RECORDED,
        createdByMembershipId: membershipId,
      },
    });
  }

  const roles = ['TENANT_ADMIN'];

  // ── DB constraints ──────────────────────────────────────────────────────

  it('enforces percentageBasisPoints range at the DB level', async () => {
    const ctx = await fixture('bp-range');
    const cat = await incomeCategory(ctx.tenant.id);
    const f = await fund(ctx.tenant.id, ctx.membership.id);
    const policy = await observer.incomePolicy.create({
      data: { tenantId: ctx.tenant.id, categoryId: cat.id, createdByMembershipId: ctx.membership.id },
    });
    const version = await observer.incomePolicyVersion.create({
      data: { policyId: policy.id, version: 1, status: 'ACTIVE', createdByMembershipId: ctx.membership.id },
    });
    const base = { tenantId: ctx.tenant.id, versionId: version.id, destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, fundId: null } as const;

    await expect(
      observer.incomePolicyRule.create({ data: { ...base, percentageBasisPoints: 0 } }),
    ).rejects.toThrow(/check constraint|Check/);
    await expect(
      observer.incomePolicyRule.create({ data: { ...base, percentageBasisPoints: -1 } }),
    ).rejects.toThrow(/check constraint|Check/);
    await expect(
      observer.incomePolicyRule.create({ data: { ...base, percentageBasisPoints: 10001 } }),
    ).rejects.toThrow(/check constraint|Check/);
    await observer.incomePolicyRule.create({ data: { ...base, percentageBasisPoints: 10000 } });
    expect(await observer.incomePolicyRule.count({ where: { versionId: version.id } })).toBe(1);
  }, 20000);

  it('enforces the destination/fund invariant at the DB level', async () => {
    const ctx = await fixture('dest-inv');
    const cat = await incomeCategory(ctx.tenant.id);
    const f = await fund(ctx.tenant.id, ctx.membership.id);
    const policy = await observer.incomePolicy.create({
      data: { tenantId: ctx.tenant.id, categoryId: cat.id, createdByMembershipId: ctx.membership.id },
    });
    const version = await observer.incomePolicyVersion.create({
      data: { policyId: policy.id, version: 1, status: 'ACTIVE', createdByMembershipId: ctx.membership.id },
    });
    const base = { tenantId: ctx.tenant.id, versionId: version.id, percentageBasisPoints: 10000 } as const;

    await expect(
      observer.incomePolicyRule.create({ data: { ...base, destinationType: IncomeApplicationDestination.FUND, fundId: null } }),
    ).rejects.toThrow(/check constraint|Check/);
    await expect(
      observer.incomePolicyRule.create({ data: { ...base, destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, fundId: f.id } }),
    ).rejects.toThrow(/check constraint|Check/);
    await observer.incomePolicyRule.create({ data: { ...base, destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, fundId: null } });
    expect(await observer.incomePolicyRule.count({ where: { versionId: version.id } })).toBe(1);
  }, 20000);

  it('enforces duplicate DB constraints per version', async () => {
    const ctx = await fixture('dup-constraints');
    const cat = await incomeCategory(ctx.tenant.id);
    const f1 = await fund(ctx.tenant.id, ctx.membership.id);
    const f2 = await fund(ctx.tenant.id, ctx.membership.id);
    const policy = await observer.incomePolicy.create({
      data: { tenantId: ctx.tenant.id, categoryId: cat.id, createdByMembershipId: ctx.membership.id },
    });
    const version = await observer.incomePolicyVersion.create({
      data: { policyId: policy.id, version: 1, status: 'ACTIVE', createdByMembershipId: ctx.membership.id },
    });
    const base = { tenantId: ctx.tenant.id, versionId: version.id, percentageBasisPoints: 10000 } as const;

    await observer.incomePolicyRule.create({ data: { ...base, destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, fundId: null } });
    await expect(
      observer.incomePolicyRule.create({ data: { ...base, destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, fundId: null } }),
    ).rejects.toThrow(/unique|duplicate/i);
    await observer.incomePolicyRule.create({ data: { ...base, destinationType: IncomeApplicationDestination.FUND, fundId: f1.id } });
    await expect(
      observer.incomePolicyRule.create({ data: { ...base, destinationType: IncomeApplicationDestination.FUND, fundId: f1.id } }),
    ).rejects.toThrow(/unique|duplicate/i);
    await observer.incomePolicyRule.create({ data: { ...base, destinationType: IncomeApplicationDestination.FUND, fundId: f2.id } });
  }, 20000);

  it('enforces a single ACTIVE version per policy at the DB level', async () => {
    const ctx = await fixture('single-active');
    const cat = await incomeCategory(ctx.tenant.id);
    const policy = await observer.incomePolicy.create({
      data: { tenantId: ctx.tenant.id, categoryId: cat.id, createdByMembershipId: ctx.membership.id },
    });
    await observer.incomePolicyVersion.create({
      data: { policyId: policy.id, version: 1, status: 'ACTIVE', createdByMembershipId: ctx.membership.id },
    });
    await expect(
      observer.incomePolicyVersion.create({
        data: { policyId: policy.id, version: 2, status: 'ACTIVE', createdByMembershipId: ctx.membership.id },
      }),
    ).rejects.toThrow(/unique|duplicate/i);
  }, 20000);

  // ── Functional ──────────────────────────────────────────────────────────

  it('creates a 70/30 policy and applies it exactly', async () => {
    const ctx = await fixture('apply-7030');
    const cat = await incomeCategory(ctx.tenant.id);
    const f = await fund(ctx.tenant.id, ctx.membership.id);
    const policy = await policies.createPolicy(ctx.tenant.id, ctx.membership.id, roles, {
      categoryId: cat.id,
      rules: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: f.id, percentageBasisPoints: 3000 },
      ],
    });
    expect(policy.currentVersion?.rules).toHaveLength(2);

    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, cat.id, 10000);
    const plan = await apps.applyPolicy(ctx.tenant.id, income.id, ctx.membership.id, roles);

    expect(plan.totalAmountMinor).toBe(10000);
    const amounts = plan.applications.map((a) => a.amountMinor).sort((a, b) => a - b);
    expect(amounts).toEqual([3000, 7000]);

    const credit = await observer.fundTransaction.findFirst({
      where: { fundId: f.id, direction: 'CREDIT' },
    });
    expect(credit).not.toBeNull();
    expect(credit!.amountMinor).toBe(3000);
    expect(credit!.currencyCode).toBe('USD');
    const app = await observer.incomeApplication.findUniqueOrThrow({ where: { id: plan.applications.find((a) => a.destinationType === 'FUND')!.id } });
    expect(app.policyVersionId).toBe(policy.currentVersion!.id);

    const audits = await observer.auditLog.findMany({
      where: { tenantId: ctx.tenant.id, action: { in: ['INCOME_POLICY_CREATE', 'INCOME_APPLICATIONS_CREATE', 'FUND_TRANSACTION_CREATE'] } },
    });
    expect(audits.some((a) => a.action === 'INCOME_POLICY_CREATE')).toBe(true);
    expect(audits.some((a) => a.action === 'INCOME_APPLICATIONS_CREATE')).toBe(true);
    expect(audits.some((a) => a.action === 'FUND_TRANSACTION_CREATE')).toBe(true);
  }, 30000);

  it('rounds 10001 with 70/30 deterministically to exactly 10001', async () => {
    const ctx = await fixture('rounding');
    const cat = await incomeCategory(ctx.tenant.id);
    const f = await fund(ctx.tenant.id, ctx.membership.id);
    await policies.createPolicy(ctx.tenant.id, ctx.membership.id, roles, {
      categoryId: cat.id,
      rules: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: f.id, percentageBasisPoints: 3000 },
      ],
    });
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, cat.id, 10001);
    const plan = await apps.applyPolicy(ctx.tenant.id, income.id, ctx.membership.id, roles);

    expect(plan.totalAmountMinor).toBe(10001);
    const amounts = plan.applications.map((a) => a.amountMinor).sort((a, b) => a - b);
    expect(amounts).toEqual([3000, 7001]);
  }, 30000);

  it('rejects a small income where a rule would become zero', async () => {
    const ctx = await fixture('small-income');
    const cat = await incomeCategory(ctx.tenant.id);
    const f = await fund(ctx.tenant.id, ctx.membership.id);
    await policies.createPolicy(ctx.tenant.id, ctx.membership.id, roles, {
      categoryId: cat.id,
      rules: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: f.id, percentageBasisPoints: 3000 },
      ],
    });
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, cat.id, 1);

    await expect(apps.applyPolicy(ctx.tenant.id, income.id, ctx.membership.id, roles)).rejects.toThrow(NestBadRequestException);

    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(0);
    expect(await observer.fundTransaction.count({ where: { fundId: f.id } })).toBe(0);
  }, 30000);

  it('applies a 100% CARRY_FORWARD policy', async () => {
    const ctx = await fixture('carry-policy');
    const cat = await incomeCategory(ctx.tenant.id);
    await policies.createPolicy(ctx.tenant.id, ctx.membership.id, roles, {
      categoryId: cat.id,
      rules: [{ destinationType: IncomeApplicationDestination.CARRY_FORWARD, percentageBasisPoints: 10000 }],
    });
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, cat.id, 10000);
    const plan = await apps.applyPolicy(ctx.tenant.id, income.id, ctx.membership.id, roles);

    expect(plan.applications).toHaveLength(1);
    expect(plan.applications[0]!.destinationType).toBe('CARRY_FORWARD');
    expect(plan.applications[0]!.amountMinor).toBe(10000);
    expect(await observer.fundTransaction.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
  }, 30000);

  it('keeps v1 applications unchanged after publishing v2 (history immutability)', async () => {
    const ctx = await fixture('policy-change');
    const cat = await incomeCategory(ctx.tenant.id);
    const f = await fund(ctx.tenant.id, ctx.membership.id);
    const v1 = await policies.createPolicy(ctx.tenant.id, ctx.membership.id, roles, {
      categoryId: cat.id,
      rules: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: f.id, percentageBasisPoints: 3000 },
      ],
    });

    // Income A aplica v1 (70/30)
    const incomeA = await recordedIncome(ctx.tenant.id, ctx.membership.id, cat.id, 10000);
    const planA = await apps.applyPolicy(ctx.tenant.id, incomeA.id, ctx.membership.id, roles);
    expect(planA.applications.find((a) => a.destinationType === 'OFFSET_EXPENSES')!.amountMinor).toBe(7000);

    // Publish v2 (100% CARRY_FORWARD)
    await policies.createVersion(ctx.tenant.id, cat.id, ctx.membership.id, roles, {
      rules: [{ destinationType: IncomeApplicationDestination.CARRY_FORWARD, percentageBasisPoints: 10000 }],
    });

    // Income A sigue 70/30 (sin mutación histórica)
    const planAAfter = await apps.getPlan(ctx.tenant.id, incomeA.id, roles);
    expect(planAAfter.applications.find((a) => a.destinationType === 'OFFSET_EXPENSES')!.amountMinor).toBe(7000);

    // Income B usa v2 (100% CARRY_FORWARD)
    const incomeB = await recordedIncome(ctx.tenant.id, ctx.membership.id, cat.id, 10000);
    const planB = await apps.applyPolicy(ctx.tenant.id, incomeB.id, ctx.membership.id, roles);
    expect(planB.applications[0]!.destinationType).toBe('CARRY_FORWARD');
    expect(planB.applications[0]!.amountMinor).toBe(10000);
    const appB = await observer.incomeApplication.findUniqueOrThrow({ where: { id: planB.applications[0]!.id } });
    const v2 = await observer.incomePolicyVersion.findFirst({ where: { policyId: v1.id, status: 'ACTIVE' } });
    expect(appB.policyVersionId).toBe(v2!.id);
  }, 30000);

  it('rejects apply-policy when the referenced fund was archived after publication', async () => {
    const ctx = await fixture('fund-archived-after');
    const cat = await incomeCategory(ctx.tenant.id);
    const f = await fund(ctx.tenant.id, ctx.membership.id);
    await policies.createPolicy(ctx.tenant.id, ctx.membership.id, roles, {
      categoryId: cat.id,
      rules: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: f.id, percentageBasisPoints: 3000 },
      ],
    });
    // Llevar el fund a cero y archivarlo (CREDIT + DEBIT)
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, cat.id, 10000);
    const plan = await apps.applyPolicy(ctx.tenant.id, income.id, ctx.membership.id, roles);
    const fundApp = plan.applications.find((a) => a.destinationType === 'FUND')!;
    await funds.createTransaction(ctx.tenant.id, f.id, ctx.membership.id, roles, {
      direction: 'DEBIT',
      amountMinor: fundApp.amountMinor,
      currencyCode: 'USD',
      occurredAt: new Date().toISOString(),
    });
    await funds.archiveFund(ctx.tenant.id, f.id, ctx.membership.id, roles);

    // Nuevo income: apply-policy debe rechazar (fund ARCHIVED)
    const income2 = await recordedIncome(ctx.tenant.id, ctx.membership.id, cat.id, 10000);
    await expect(apps.applyPolicy(ctx.tenant.id, income2.id, ctx.membership.id, roles)).rejects.toThrow(NestBadRequestException);
    expect(await observer.incomeApplication.count({ where: { incomeId: income2.id } })).toBe(0);
  }, 30000);

  // ── Concurrency ─────────────────────────────────────────────────────────

  it('serializes concurrent policy version publish (single current version)', async () => {
    const ctx = await fixture('publish-race');
    const cat = await incomeCategory(ctx.tenant.id);
    await policies.createPolicy(ctx.tenant.id, ctx.membership.id, roles, {
      categoryId: cat.id,
      rules: [{ destinationType: IncomeApplicationDestination.CARRY_FORWARD, percentageBasisPoints: 10000 }],
    });
    const svcB = buildServices(clientB).policies;
    const newRules = { rules: [{ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 10000 }] };

    const [a, b] = await Promise.all([
      policies.createVersion(ctx.tenant.id, cat.id, ctx.membership.id, roles, newRules).then(() => ({ ok: true as const })),
      svcB.createVersion(ctx.tenant.id, cat.id, ctx.membership.id, roles, newRules).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, conflict: error instanceof NestConflictException }),
      ),
    ]);

    const actives = await observer.incomePolicyVersion.findMany({
      where: { status: 'ACTIVE', policy: { tenantId: ctx.tenant.id, categoryId: cat.id } },
    });
    expect(actives).toHaveLength(1);
    expect(a.ok || b.ok).toBe(true);
  }, 30000);

  it('applies policy concurrently to the same income exactly once', async () => {
    const ctx = await fixture('apply-race');
    const cat = await incomeCategory(ctx.tenant.id);
    const f = await fund(ctx.tenant.id, ctx.membership.id);
    await policies.createPolicy(ctx.tenant.id, ctx.membership.id, roles, {
      categoryId: cat.id,
      rules: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: f.id, percentageBasisPoints: 3000 },
      ],
    });
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, cat.id, 10000);
    const svcB = buildServices(clientB).apps;

    const [a, b] = await Promise.all([
      apps.applyPolicy(ctx.tenant.id, income.id, ctx.membership.id, roles).then(() => ({ ok: true as const })),
      svcB.applyPolicy(ctx.tenant.id, income.id, ctx.membership.id, roles).then(() => ({ ok: true as const })),
    ]);

    expect(a.ok && b.ok).toBe(true);
    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(2);
    expect(await observer.fundTransaction.count({ where: { fundId: f.id, direction: 'CREDIT' } })).toBe(1);
  }, 30000);

  // ── Isolation / delete ──────────────────────────────────────────────────

  it('rejects cross-tenant category and fund', async () => {
    const ctxA = await fixture('iso-a');
    const ctxB = await fixture('iso-b');
    const catB = await incomeCategory(ctxB.tenant.id);
    const fundB = await fund(ctxB.tenant.id, ctxB.membership.id);

    // Categoría de tenant B usada en tenant A → not found
    await expect(
      policies.createPolicy(ctxA.tenant.id, ctxA.membership.id, roles, {
        categoryId: catB.id,
        rules: [{ destinationType: IncomeApplicationDestination.CARRY_FORWARD, percentageBasisPoints: 10000 }],
      }),
    ).rejects.toThrow(/no encontrada|not found/i);

    // Fund de tenant B en política de tenant A → not found
    const catA = await incomeCategory(ctxA.tenant.id);
    await expect(
      policies.createPolicy(ctxA.tenant.id, ctxA.membership.id, roles, {
        categoryId: catA.id,
        rules: [{ destinationType: IncomeApplicationDestination.FUND, fundId: fundB.id, percentageBasisPoints: 10000 }],
      }),
    ).rejects.toThrow(/no encontrado|not found/i);
  }, 30000);

  it('preserves tenant delete lifecycle (policy/version/rules cascade)', async () => {
    const ctx = await fixture('fk-delete');
    const cat = await incomeCategory(ctx.tenant.id);
    await policies.createPolicy(ctx.tenant.id, ctx.membership.id, roles, {
      categoryId: cat.id,
      rules: [{ destinationType: IncomeApplicationDestination.CARRY_FORWARD, percentageBasisPoints: 10000 }],
    });

    await observer.tenant.delete({ where: { id: ctx.tenant.id } });
    expect(await observer.incomePolicy.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    expect(await observer.incomePolicyVersion.count({ where: { policy: { tenantId: ctx.tenant.id } } })).toBe(0);
    expect(await observer.incomePolicyRule.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    tenantIds.splice(tenantIds.indexOf(ctx.tenant.id), 1);
    membershipIds.splice(membershipIds.indexOf(ctx.membership.id), 1);
  }, 30000);

  it('leaves no leftovers after the suite', async () => {
    const leftover = await observer.tenant.count({ where: { name: { startsWith: `${fixturePhase}-` } } });
    expect(leftover).toBe(0);
  }, 10000);
});
