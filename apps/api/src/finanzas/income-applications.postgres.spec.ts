import {
  FundStatus,
  FundTransactionDirection,
  IncomeApplicationDestination,
  IncomeStatus,
  PrismaClient,
  TenantType,
} from '@prisma/client';
import {
  BadRequestException as NestBadRequestException,
  ConflictException as NestConflictException,
} from '@nestjs/common';
import { IncomeApplicationsService } from './income-applications.service';
import { IncomesService } from './incomes.service';
import { FundsService } from './funds.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { PrismaService } from '../prisma/prisma.service';
import { MovementAllocationService } from './movement-allocation.service';
import { CurrencyConversionService } from './currency-conversion.service';

const ACCEPTANCE_DATABASES = new Set(['buildingos_fin03_acceptance']);
const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
const fixturePhase = 'fin03';
const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  expectedDatabaseName !== undefined &&
  ACCEPTANCE_DATABASES.has(expectedDatabaseName);
const describePostgres = enabled ? describe : describe.skip;

describePostgres('IncomeApplications PostgreSQL (FIN-03)', () => {
  let observer: PrismaClient;
  let clientA: PrismaClient;
  let clientB: PrismaClient;
  let appsService: IncomeApplicationsService;
  let fundsService: FundsService;
  let incomesService: IncomesService;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const membershipIds: string[] = [];

  function buildServices(client: PrismaClient) {
    const prisma = client as unknown as PrismaService;
    const audit = new AuditService(prisma);
    const validators = new FinanzasValidators(prisma);
    return {
      apps: new IncomeApplicationsService(prisma, audit, validators),
      funds: new FundsService(prisma, audit, validators),
      incomes: new IncomesService(
        prisma,
        audit,
        validators,
        new MovementAllocationService(prisma, audit, validators),
        new CurrencyConversionService(prisma),
      ),
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
    appsService = svcA.apps;
    fundsService = svcA.funds;
    incomesService = svcA.incomes;
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
      data: {
        email: `${fixturePhase}-${suffix}@buildingos.local`,
        name: `${fixturePhase} ${label}`,
        passwordHash: 'test',
      },
    });
    userIds.push(user.id);
    const membership = await observer.membership.create({
      data: { tenantId: tenant.id, userId: user.id },
    });
    membershipIds.push(membership.id);
    return { tenant, membership };
  }

  async function recordedIncome(tenantId: string, amountMinor = 10000, currencyCode = 'USD') {
    const income = await observer.income.create({
      data: {
        tenantId,
        period: '2026-08',
        categoryId: await ensureIncomeCategory(tenantId),
        amountMinor,
        currencyCode,
        receivedDate: new Date('2026-08-10T00:00:00.000Z'),
        status: IncomeStatus.RECORDED,
        createdByMembershipId: membershipIds[membershipIds.length - 1]!,
        scopeType: 'BUILDING',
      },
    });
    return income;
  }

  async function ensureIncomeCategory(tenantId: string) {
    let category = await observer.expenseLedgerCategory.findFirst({
      where: { tenantId, movementType: 'INCOME' },
    });
    if (!category) {
      category = await observer.expenseLedgerCategory.create({
        data: { tenantId, name: `Income Cat ${Date.now()}`, movementType: 'INCOME' },
      });
    }
    return category.id;
  }

  const roles = ['TENANT_ADMIN'];

  // ── DB constraints ──────────────────────────────────────────────────────

  it('enforces amountMinor > 0 at the database level', async () => {
    const ctx = await fixture('amount-minor');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const base = {
      tenantId: ctx.tenant.id,
      incomeId: income.id,
      destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
      fundId: null,
      currencyCode: 'USD',
      createdByMembershipId: ctx.membership.id,
    } as const;

    await expect(
      observer.incomeApplication.create({ data: { ...base, amountMinor: 0 } }),
    ).rejects.toThrow(/check constraint|Check/);
    await expect(
      observer.incomeApplication.create({ data: { ...base, amountMinor: -1 } }),
    ).rejects.toThrow(/check constraint|Check/);
    await observer.incomeApplication.create({ data: { ...base, amountMinor: 1 } });
    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(1);
  }, 20000);

  it('enforces the destination/fund invariant at the database level', async () => {
    const ctx = await fixture('dest-invariant');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const base = {
      tenantId: ctx.tenant.id,
      incomeId: income.id,
      currencyCode: 'USD',
      createdByMembershipId: ctx.membership.id,
    } as const;

    // FUND + fundId null → reject
    await expect(
      observer.incomeApplication.create({
        data: { ...base, destinationType: IncomeApplicationDestination.FUND, fundId: null, amountMinor: 10000 },
      }),
    ).rejects.toThrow(/check constraint|Check/);
    // OFFSET + fundId → reject
    await expect(
      observer.incomeApplication.create({
        data: { ...base, destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, fundId: 'x', amountMinor: 10000 },
      }),
    ).rejects.toThrow(/check constraint|Check/);
    // CARRY + fundId → reject
    await expect(
      observer.incomeApplication.create({
        data: { ...base, destinationType: IncomeApplicationDestination.CARRY_FORWARD, fundId: 'x', amountMinor: 10000 },
      }),
    ).rejects.toThrow(/check constraint|Check/);
    // valid combos → allowed
    await observer.incomeApplication.create({
      data: { ...base, destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, fundId: null, amountMinor: 10000 },
    });
    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(1);
  }, 20000);

  it('enforces duplicate DB constraints (one OFFSET, one CARRY, one FUND per fund)', async () => {
    const ctx = await fixture('dup-constraints');
    const income = await recordedIncome(ctx.tenant.id, 30000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });
    const base = {
      tenantId: ctx.tenant.id,
      incomeId: income.id,
      currencyCode: 'USD',
      createdByMembershipId: ctx.membership.id,
    } as const;

    await observer.incomeApplication.create({
      data: { ...base, destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 10000 },
    });
    await observer.incomeApplication.create({
      data: { ...base, destinationType: IncomeApplicationDestination.CARRY_FORWARD, amountMinor: 10000 },
    });
    await observer.incomeApplication.create({
      data: { ...base, destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 10000 },
    });

    // duplicates → reject (partial unique)
    await expect(
      observer.incomeApplication.create({
        data: { ...base, destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 10000 },
      }),
    ).rejects.toThrow(/unique|duplicate/);
    await expect(
      observer.incomeApplication.create({
        data: { ...base, destinationType: IncomeApplicationDestination.CARRY_FORWARD, amountMinor: 10000 },
      }),
    ).rejects.toThrow(/unique|duplicate/);
    await expect(
      observer.incomeApplication.create({
        data: { ...base, destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 10000 },
      }),
    ).rejects.toThrow(/unique|duplicate/);
  }, 20000);

  // ── Functional: exact plan + Fund CREDIT + rollbacks ────────────────────

  it('creates an exact 70/30 plan with a real Fund CREDIT', async () => {
    const ctx = await fixture('exact-split');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });

    const result = await appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
      applications: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 },
      ],
    });

    expect(result.applications).toHaveLength(2);
    expect(result.totalAmountMinor).toBe(10000);

    const credits = await observer.fundTransaction.findMany({
      where: { fundId: fund.id, direction: FundTransactionDirection.CREDIT },
    });
    expect(credits).toHaveLength(1);
    expect(credits[0]!.amountMinor).toBe(3000);
    expect(credits[0]!.currencyCode).toBe('USD');
    expect(credits[0]!.incomeApplicationId).not.toBeNull();
    const app = await observer.incomeApplication.findUniqueOrThrow({ where: { id: result.applications.find((a) => a.destinationType === 'FUND')!.id } });
    expect(app.fundId).toBe(fund.id);

    // balance del fund
    const fundAfter = await fundsService.getFund(ctx.tenant.id, fund.id, roles);
    expect(fundAfter.balancesByCurrency).toEqual([{ currency: 'USD', amountMinor: 3000 }]);
  }, 20000);

  it('rolls back on underallocation (no applications, no FundTransactions)', async () => {
    const ctx = await fixture('underalloc');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });

    await expect(
      appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
        applications: [
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
          { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 2999 },
        ],
      }),
    ).rejects.toThrow(NestBadRequestException);

    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(0);
    expect(await observer.fundTransaction.count({ where: { fundId: fund.id } })).toBe(0);
  }, 20000);

  it('rolls back on overallocation (no applications, no FundTransactions)', async () => {
    const ctx = await fixture('overalloc');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });

    await expect(
      appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
        applications: [
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
          { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3001 },
        ],
      }),
    ).rejects.toThrow(NestBadRequestException);

    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(0);
    expect(await observer.fundTransaction.count({ where: { fundId: fund.id } })).toBe(0);
  }, 20000);

  // ── Real AuditService + nullable metadata ───────────────────────────────

  it('creates a plan with real AuditService (no null metadata error)', async () => {
    const ctx = await fixture('real-audit');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });

    const result = await appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
      applications: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 },
      ],
    });
    expect(result.applications).toHaveLength(2);

    const audit = await observer.auditLog.findFirst({
      where: { tenantId: ctx.tenant.id, action: 'INCOME_APPLICATIONS_CREATE', entityId: income.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    const metadata = audit!.metadata as Record<string, unknown>;
    expect(metadata.applications).toHaveLength(2);
  }, 20000);

  // ── Idempotency / conflict ──────────────────────────────────────────────

  it('returns the same plan on a concurrent same-plan retry (no double credit)', async () => {
    const ctx = await fixture('idem-same');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });
    const svcB = buildServices(clientB).apps;
    const plan = {
      applications: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 },
      ],
    };

    const [a, b] = await Promise.all([
      appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, plan),
      svcB.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, plan),
    ]);

    expect(a.applications).toHaveLength(2);
    expect(b.applications).toHaveLength(2);
    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(2);
    expect(await observer.fundTransaction.count({ where: { fundId: fund.id, direction: FundTransactionDirection.CREDIT } })).toBe(1);
  }, 30000);

  it('only one concurrent different plan wins (Conflict for the other)', async () => {
    const ctx = await fixture('idem-diff');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });
    const svcB = buildServices(clientB).apps;

    const planA = { applications: [{ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 }, { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 }] };
    const planB = { applications: [{ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 6000 }, { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 }, { destinationType: IncomeApplicationDestination.CARRY_FORWARD, amountMinor: 1000 }] };

    const [a, b] = await Promise.all([
      appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, planA).then(() => ({ ok: true as const })),
      svcB.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, planB).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, conflict: error instanceof NestConflictException }),
      ),
    ]);

    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.conflict).toBe(true);
    expect(await observer.fundTransaction.count({ where: { fundId: fund.id, direction: FundTransactionDirection.CREDIT } })).toBe(1);
  }, 30000);

  // ── Void / reversal / double-void ───────────────────────────────────────

  it('void reverses the application CREDIT and makes the fund net zero', async () => {
    const ctx = await fixture('void-reversal');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });
    await appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
      applications: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 },
      ],
    });

    await incomesService.voidIncome(ctx.tenant.id, income.id, ctx.membership.id, roles);

    const incomeAfter = await observer.income.findUniqueOrThrow({ where: { id: income.id } });
    expect(incomeAfter.status).toBe(IncomeStatus.VOID);

    // CREDIT original permanece + reversal DEBIT
    const txs = await observer.fundTransaction.findMany({ where: { fundId: fund.id }, orderBy: { createdAt: 'asc' } });
    expect(txs).toHaveLength(2);
    expect(txs[0]!.direction).toBe(FundTransactionDirection.CREDIT);
    expect(txs[1]!.direction).toBe(FundTransactionDirection.DEBIT);
    expect(txs[1]!.reversalOfTransactionId).toBe(txs[0]!.id);

    const fundAfter = await fundsService.getFund(ctx.tenant.id, fund.id, roles);
    expect(fundAfter.balancesByCurrency).toEqual([{ currency: 'USD', amountMinor: 0 }]);
  }, 30000);

  it('double void does not create a second reversal', async () => {
    const ctx = await fixture('double-void');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });
    await appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
      applications: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 },
      ],
    });

    await incomesService.voidIncome(ctx.tenant.id, income.id, ctx.membership.id, roles);
    await incomesService.voidIncome(ctx.tenant.id, income.id, ctx.membership.id, roles);

    const txs = await observer.fundTransaction.findMany({ where: { fundId: fund.id } });
    expect(txs).toHaveLength(2); // CREDIT + 1 reversal (no second)
  }, 30000);

  // ── Generic reversal protection ─────────────────────────────────────────

  it('rejects a generic Fund reversal of an application-owned CREDIT', async () => {
    const ctx = await fixture('gen-rev-protect');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });
    const plan = await appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
      applications: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 },
      ],
    });
    const fundApp = plan.applications.find((a) => a.destinationType === 'FUND')!;

    await expect(
      fundsService.reverseTransaction(ctx.tenant.id, fund.id, fundApp.fundTransactionId!, ctx.membership.id, roles, { reason: 'generic attempt' }),
    ).rejects.toThrow(NestConflictException);

    const txs = await observer.fundTransaction.findMany({ where: { fundId: fund.id } });
    expect(txs).toHaveLength(1); // sin reversal genérica
  }, 30000);

  // ── Application vs void race ────────────────────────────────────────────

  it('serializes application vs void (only serializable outcomes)', async () => {
    const ctx = await fixture('app-void-race');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });
    const svcB = buildServices(clientB);

    const [planResult, voidResult] = await Promise.all([
      appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
        applications: [
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
          { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 },
        ],
      }).then(() => ({ ok: true as const })),
      svcB.incomes.voidIncome(ctx.tenant.id, income.id, ctx.membership.id, roles).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
      ),
    ]);

    const incomeAfter = await observer.income.findUniqueOrThrow({ where: { id: income.id } });
    const credits = await observer.fundTransaction.count({ where: { fundId: fund.id, direction: FundTransactionDirection.CREDIT } });
    const debits = await observer.fundTransaction.count({ where: { fundId: fund.id, direction: FundTransactionDirection.DEBIT } });
    const net = credits - debits;

    // Outcome 1: plan primero → void reversa → VOID + net 0
    // Outcome 2: void primero → plan rechaza → VOID + net 0
    // Nunca: crédito efectivo posterior a VOID
    expect(incomeAfter.status).toBe(IncomeStatus.VOID);
    if (net > 0) {
      // Si quedó crédito sin reversar, el plan habría ganado Y void fallado:
      // solo válido si el Income NO quedó VOID.
      expect(planResult.ok).toBe(true);
      expect(voidResult.ok).toBe(false);
    } else {
      expect(net).toBe(0);
    }
    // Invariante crítico: no puede haber CREDIT efectivo sin reversal con Income VOID
    if (incomeAfter.status === IncomeStatus.VOID) {
      const balanceRows = await observer.$queryRaw<Array<{ total: bigint | null }>>`
        SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN "amountMinor" ELSE -"amountMinor" END), 0) AS total
        FROM "FundTransaction" WHERE "fundId" = ${fund.id} AND "tenantId" = ${ctx.tenant.id}
      `;
      expect(Number(balanceRows[0]?.total ?? 0)).toBe(0);
    }
  }, 30000);

  // ── Multi-fund deterministic locks ──────────────────────────────────────

  it('handles a multi-fund plan without deadlock', async () => {
    const ctx = await fixture('multi-fund');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund1 = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F1 ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });
    const fund2 = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F2 ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });
    const fund3 = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F3 ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });

    const result = await appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
      applications: [
        { destinationType: IncomeApplicationDestination.FUND, fundId: fund1.id, amountMinor: 3000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: fund2.id, amountMinor: 3000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: fund3.id, amountMinor: 4000 },
      ],
    });

    expect(result.applications).toHaveLength(3);
    expect(await observer.fundTransaction.count({ where: { fundId: { in: [fund1.id, fund2.id, fund3.id] } } })).toBe(3);
  }, 30000);

  // ── Tenant isolation ────────────────────────────────────────────────────

  it('denies access to a plan of another tenant', async () => {
    const ctxA = await fixture('iso-a');
    const ctxB = await fixture('iso-b');
    const income = await recordedIncome(ctxA.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctxA.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctxA.membership.id },
    });
    await appsService.createPlan(ctxA.tenant.id, income.id, ctxA.membership.id, roles, {
      applications: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 },
      ],
    });

    const svcB = buildServices(clientB).apps;
    await expect(svcB.getPlan(ctxB.tenant.id, income.id, roles)).rejects.toThrow(/no encontrado|not found/i);
  }, 30000);

  // ── FK / delete safety ──────────────────────────────────────────────────

  it('does not break the tenant delete lifecycle (IncomeApplication cascade)', async () => {
    const ctx = await fixture('fk-delete');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });
    await appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
      applications: [
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 },
      ],
    });

    // DELETE del Income → Restrict (plan protegido)
    await expect(observer.income.delete({ where: { id: income.id } })).rejects.toThrow(/foreign key/i);

    // DELETE del Tenant → cascade completo (lifecycle del repo intacto)
    await observer.tenant.delete({ where: { id: ctx.tenant.id } });
    expect(await observer.incomeApplication.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    expect(await observer.fundTransaction.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    tenantIds.splice(tenantIds.indexOf(ctx.tenant.id), 1);
    membershipIds.splice(membershipIds.indexOf(ctx.membership.id), 1);
  }, 30000);

  // ── Application vs Fund archive race ────────────────────────────────────

  it('serializes application vs Fund archive (never ARCHIVED with new CREDIT)', async () => {
    const ctx = await fixture('app-archive-race');
    const income = await recordedIncome(ctx.tenant.id, 10000);
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });
    const svcB = buildServices(clientB);

    const [planResult, archiveResult] = await Promise.all([
      appsService.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
        applications: [
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
          { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 },
        ],
      }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
      ),
      svcB.funds.archiveFund(ctx.tenant.id, fund.id, ctx.membership.id, roles).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
      ),
    ]);

    const fundAfter = await observer.fund.findUniqueOrThrow({ where: { id: fund.id } });
    const credits = await observer.fundTransaction.count({ where: { fundId: fund.id, direction: FundTransactionDirection.CREDIT } });

    if (fundAfter.status === FundStatus.ARCHIVED) {
      // archive ganó → application debió fallar → sin CREDIT
      expect(planResult.ok).toBe(false);
      expect(credits).toBe(0);
    } else {
      // application ganó → CREDIT existe → archive debió fallar por saldo != 0
      expect(archiveResult.ok).toBe(false);
      expect(credits).toBe(1);
    }
    // Invariante: nunca ARCHIVED con CREDIT posterior efectivo
    if (fundAfter.status === FundStatus.ARCHIVED) {
      expect(credits).toBe(0);
    }
  }, 30000);

  // ── No leftovers ────────────────────────────────────────────────────────

  it('leaves no leftovers after the suite', async () => {
    const leftover = await observer.tenant.count({ where: { name: { startsWith: `${fixturePhase}-` } } });
    expect(leftover).toBe(0);
  }, 10000);
});
