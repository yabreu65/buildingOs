import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  IncomeApplicationDestination,
  IncomeStatus,
  MovementScope,
  PrismaClient,
  TenantType,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { FinanzasValidators } from './finanzas.validators';
import { ResidentAccessService } from '../resident-access/resident-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LiquidationsService } from './liquidations.service';
import { LiquidationIncomeOffsetsService } from './liquidation-income-offsets.service';
import { IncomesService } from './incomes.service';
import { IncomeApplicationsService } from './income-applications.service';
import { FundsService } from './funds.service';
import { CurrencyConversionService } from './currency-conversion.service';
import { MovementAllocationService } from './movement-allocation.service';
import {
  createLiquidationWorkflowDependencies,
  LiquidationPublicationUseCase,
} from './liquidation-publication.use-case';

const ACCEPTANCE_DATABASES = new Set(['buildingos_fin06_acceptance']);
const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
const fixturePhase = 'fin06';
const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  expectedDatabaseName !== undefined &&
  ACCEPTANCE_DATABASES.has(expectedDatabaseName);
const describePostgres = enabled ? describe : describe.skip;

describePostgres('FIN-06 income offsets → liquidation (PostgreSQL)', () => {
  let observer: PrismaClient;
  let liquidations: LiquidationsService;
  let incomes: IncomesService;
  let apps: IncomeApplicationsService;
  let funds: FundsService;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const membershipIds: string[] = [];

  const roles = ['TENANT_ADMIN'];

  function buildServices(client: PrismaClient) {
    const prisma = client as unknown as PrismaService;
    const audit = new AuditService(prisma);
    const validators = new FinanzasValidators(
      prisma,
      new ResidentAccessService(prisma),
    );
    const notifications = {
      createNotification: () => Promise.resolve({ id: 'n' }),
    } as unknown as NotificationsService;
    const useCase = new LiquidationPublicationUseCase(
      createLiquidationWorkflowDependencies({
        prisma,
        auditService: audit,
        validators,
        notificationsService: notifications,
      }),
    );
    return {
      liquidations: new LiquidationsService(
        prisma,
        audit,
        validators,
        useCase,
        new LiquidationIncomeOffsetsService(prisma),
      ),
      incomes: new IncomesService(
        prisma,
        audit,
        validators,
        new MovementAllocationService(prisma, audit, validators),
        new CurrencyConversionService(prisma),
      ),
      apps: new IncomeApplicationsService(prisma, audit, validators),
      funds: new FundsService(prisma, audit, validators),
    };
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    observer = new PrismaClient();
    await observer.$connect();
    const [database] = await observer.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (database?.name !== expectedDatabaseName || !ACCEPTANCE_DATABASES.has(database.name)) {
      throw new Error(`Refusing destructive test database ${database?.name ?? 'unknown'}`);
    }
    const svc = buildServices(observer);
    liquidations = svc.liquidations;
    incomes = svc.incomes;
    apps = svc.apps;
    funds = svc.funds;
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

  afterAll(async () => observer?.$disconnect());

  async function fixture(label: string) {
    const suffix = `${Date.now()}-${Math.random()}`;
    const tenant = await observer.tenant.create({
      data: {
        name: `${fixturePhase}-${label}-${suffix}`,
        type: TenantType.ADMINISTRADORA,
        functionalCurrency: 'ARS',
      },
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
    const membership = await observer.membership.create({ data: { tenantId: tenant.id, userId: user.id } });
    membershipIds.push(membership.id);
    await observer.membershipRole.create({
      data: { tenantId: tenant.id, membershipId: membership.id, role: 'TENANT_ADMIN', scopeType: 'TENANT' },
    });
    return { tenant, membership };
  }

  async function building(tenantId: string, label: string) {
    return observer.building.create({
      data: {
        tenantId,
        name: `Building ${label} ${Date.now()}`,
        alias: `B-${label}-${Date.now().toString(36)}`,
      },
    });
  }

  async function units(tenantId: string, buildingId: string, count = 2) {
    return Promise.all(
      Array.from({ length: count }, (_, i) =>
        observer.unit.create({
          data: {
            tenantId,
            buildingId,
            code: `U-${i + 1}-${Date.now().toString(36)}`,
            label: `Unit ${i + 1}`,
            unitType: 'APARTAMENTO',
            occupancyStatus: 'OCCUPIED',
            isBillable: true,
          },
        }),
      ),
    );
  }

  async function incomeCategory(tenantId: string) {
    return observer.expenseLedgerCategory.create({
      data: { tenantId, name: `Inc ${Date.now()}`, movementType: 'INCOME' },
    });
  }

  async function expenseCategory(tenantId: string) {
    return observer.expenseLedgerCategory.create({
      data: { tenantId, name: `Exp ${Date.now()}`, movementType: 'EXPENSE' },
    });
  }

  async function validatedExpense(
    tenantId: string,
    buildingId: string,
    categoryId: string,
    amountMinor: number,
    functional?: { functionalAmountMinor: number; functionalCurrencyCode: string },
  ) {
    return observer.expense.create({
      data: {
        tenantId,
        buildingId,
        period: '2026-08',
        categoryId,
        amountMinor,
        currencyCode: 'ARS',
        invoiceDate: new Date('2026-08-05T00:00:00.000Z'),
        status: 'VALIDATED',
        scopeType: 'BUILDING',
        createdByMembershipId: membershipIds[membershipIds.length - 1]!,
        ...(functional
          ? {
              functionalAmountMinor: functional.functionalAmountMinor,
              functionalCurrencyCode: functional.functionalCurrencyCode,
              exchangeRateValue: '1',
              exchangeRateDirection: 'IDENTITY',
              conversionDate: new Date('2026-08-05T00:00:00.000Z'),
            }
          : {}),
      },
    });
  }

  async function recordedIncome(
    tenantId: string,
    membershipId: string,
    categoryId: string,
    params: {
      amountMinor: number;
      period?: string;
      buildingId?: string | null;
      scopeType?: MovementScope;
      functionalAmountMinor?: number | null;
      functionalCurrencyCode?: string | null;
      currencyCode?: string;
      status?: IncomeStatus;
    } = { amountMinor: 10000 },
  ) {
    const income = await observer.income.create({
      data: {
        tenantId,
        period: params.period ?? '2026-08',
        categoryId,
        amountMinor: params.amountMinor,
        currencyCode: params.currencyCode ?? 'ARS',
        receivedDate: new Date('2026-08-10T00:00:00.000Z'),
        status: IncomeStatus.RECORDED,
        scopeType: params.scopeType ?? MovementScope.BUILDING,
        buildingId: params.buildingId ?? null,
        functionalAmountMinor: params.functionalAmountMinor ?? null,
        functionalCurrencyCode: params.functionalCurrencyCode ?? null,
        createdByMembershipId: membershipId,
        ...(params.status ? { status: params.status } : {}),
      },
    });
    return income;
  }

  async function allocateIncome(tenantId: string, incomeId: string, allocations: Array<{ buildingId: string; amountMinor: number }>) {
    await observer.movementAllocation.createMany({
      data: allocations.map((allocation) => ({
        tenantId,
        incomeId,
        buildingId: allocation.buildingId,
        amountMinor: allocation.amountMinor,
      })),
    });
  }

  async function createOffsetApplications(tenantId: string, incomeId: string, appsData: Array<{
    destinationType: IncomeApplicationDestination;
    amountMinor: number;
    fundId?: string | null;
    policyVersionId?: string | null;
    currencyCode?: string;
  }>) {
    for (const app of appsData) {
      await observer.incomeApplication.create({
        data: {
          tenantId,
          incomeId,
          destinationType: app.destinationType,
          fundId: app.fundId ?? null,
          amountMinor: app.amountMinor,
          currencyCode: app.currencyCode ?? 'ARS',
          createdByMembershipId: membershipIds[membershipIds.length - 1]!,
          policyVersionId: app.policyVersionId ?? null,
        },
      });
    }
  }

  async function createLiquidationFlow(
    tenantId: string,
    buildingId: string,
    membershipId: string,
    period = '2026-08',
  ) {
    const draft = await liquidations.createDraft(tenantId, membershipId, {
      buildingId,
      period,
      baseCurrency: 'ARS',
    });
    const reviewed = await liquidations.reviewLiquidation(tenantId, draft.id, membershipId);
    return { draft, reviewed };
  }

  // ── A. schema constraints ────────────────────────────────────────────────

  it('A. enforces positive reference amounts at the DB level', async () => {
    const ctx = await fixture('db-constraints');
    const buildingA = await building(ctx.tenant.id, 'A');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, cat.id, { amountMinor: 1000 });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 1000 },
    ]);
    const liq = await observer.liquidation.create({
      data: {
        tenantId: ctx.tenant.id,
        buildingId: buildingA.id,
        period: '2026-08',
        baseCurrency: 'ARS',
        totalAmountMinor: 0,
        totalsByCurrency: { ARS: 0 },
        expenseSnapshot: [],
        unitCount: 1,
        generatedByMembershipId: ctx.membership.id,
        grossExpenseAmountMinor: 1000,
        adjustmentAmountMinor: 0,
        preIncomeAmountMinor: 1000,
        incomeOffsetAmountMinor: 1000,
        netDistributableAmountMinor: 0,
      },
    });

    await expect(
      observer.liquidationIncomeOffset.create({
        data: {
          tenantId: ctx.tenant.id,
          liquidationId: liq.id,
          incomeApplicationId: (
            await observer.incomeApplication.findFirstOrThrow({ where: { incomeId: income.id } })
          ).id,
          buildingId: buildingA.id,
          originalAmountMinor: -1,
          currencyCode: 'ARS',
          valuedAmountMinor: 1000,
          baseCurrency: 'ARS',
        },
      }),
    ).rejects.toThrow();
  }, 20000);

  // ── A2. DB summary invariants (FIN-06R hardening migration) ─────────────

  const summaryBase = {
    tenantId: '',
    buildingId: '',
    period: '2026-08',
    baseCurrency: 'ARS',
    totalAmountMinor: 5000,
    totalsByCurrency: { ARS: 10000 },
    expenseSnapshot: [],
    unitCount: 1,
    generatedByMembershipId: '',
    grossExpenseAmountMinor: 10000,
    adjustmentAmountMinor: 0,
    preIncomeAmountMinor: 10000,
    incomeOffsetAmountMinor: 5000,
    netDistributableAmountMinor: 5000,
  };

  async function createSummaryLiquidation(overrides: Record<string, unknown>) {
    const ctx = await fixture('db-summary');
    const buildingA = await building(ctx.tenant.id, 'A');
    return observer.liquidation.create({
      data: {
        ...summaryBase,
        tenantId: ctx.tenant.id,
        buildingId: buildingA.id,
        generatedByMembershipId: ctx.membership.id,
        ...overrides,
      },
    });
  }

  it('A2.1 legacy row with all FIN-06 fields null is allowed', async () => {
    const liq = await createSummaryLiquidation({
      grossExpenseAmountMinor: null,
      adjustmentAmountMinor: null,
      preIncomeAmountMinor: null,
      incomeOffsetAmountMinor: null,
      netDistributableAmountMinor: null,
    });

    expect(liq.id).toBeDefined();
  }, 20000);

  it('A2.2 valid FIN-06 equation is allowed', async () => {
    const liq = await createSummaryLiquidation({});
    expect(liq.id).toBeDefined();
  }, 20000);

  it('A2.3 negative gross is rejected', async () => {
    await expect(
      createSummaryLiquidation({ grossExpenseAmountMinor: -1 }),
    ).rejects.toThrow(/check constraint|Check/);
  }, 20000);

  it('A2.4 negative offset is rejected', async () => {
    await expect(
      createSummaryLiquidation({ incomeOffsetAmountMinor: -5 }),
    ).rejects.toThrow(/check constraint|Check/);
  }, 20000);

  it('A2.5 negative net is rejected', async () => {
    await expect(
      createSummaryLiquidation({ netDistributableAmountMinor: -5 }),
    ).rejects.toThrow(/check constraint|Check/);
  }, 20000);

  it('A2.6 gross + adjustment != preIncome is rejected', async () => {
    await expect(
      createSummaryLiquidation({ preIncomeAmountMinor: 9000 }),
    ).rejects.toThrow(/check constraint|Check/);
  }, 20000);

  it('A2.7 preIncome - offset != net is rejected', async () => {
    await expect(
      createSummaryLiquidation({ netDistributableAmountMinor: 4000 }),
    ).rejects.toThrow(/check constraint|Check/);
  }, 20000);

  it('A2.8 net != totalAmountMinor is rejected', async () => {
    await expect(
      createSummaryLiquidation({ totalAmountMinor: 4000 }),
    ).rejects.toThrow(/check constraint|Check/);
  }, 20000);

  it('A2.9 partial FIN-06 summary fields are rejected', async () => {
    await expect(
      createSummaryLiquidation({
        grossExpenseAmountMinor: null,
        adjustmentAmountMinor: null,
        preIncomeAmountMinor: null,
        incomeOffsetAmountMinor: null,
      }),
    ).rejects.toThrow(/check constraint|Check/);
  }, 20000);

  it('B. FK/delete lifecycle: tenant hard-delete removes offset references', async () => {
    const ctx = await fixture('fk-delete');
    const buildingA = await building(ctx.tenant.id, 'A');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, cat.id, { amountMinor: 1000 });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 1000 },
    ]);
    const liq = await observer.liquidation.create({
      data: {
        tenantId: ctx.tenant.id,
        buildingId: buildingA.id,
        period: '2026-08',
        baseCurrency: 'ARS',
        totalAmountMinor: 0,
        totalsByCurrency: { ARS: 0 },
        expenseSnapshot: [],
        unitCount: 1,
        generatedByMembershipId: ctx.membership.id,
      },
    });
    const app = await observer.incomeApplication.findFirstOrThrow({ where: { incomeId: income.id } });
    await observer.liquidationIncomeOffset.create({
      data: {
        tenantId: ctx.tenant.id,
        liquidationId: liq.id,
        incomeApplicationId: app.id,
        buildingId: buildingA.id,
        originalAmountMinor: 1000,
        currencyCode: 'ARS',
        valuedAmountMinor: 1000,
        baseCurrency: 'ARS',
      },
    });

    await observer.tenant.delete({ where: { id: ctx.tenant.id } });

    expect(await observer.liquidationIncomeOffset.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    tenantIds.splice(tenantIds.indexOf(ctx.tenant.id), 1);
    membershipIds.splice(membershipIds.indexOf(ctx.membership.id), 1);
    userIds.splice(userIds.indexOf(ctx.userId), 1);
  }, 30000);

  // ── C–R. Functional flow ────────────────────────────────────────────────

  it('C. building income offset reduces the liquidation net', async () => {
    const ctx = await fixture('building-offset');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
    ]);

    const { draft } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);

    expect(draft.totalAmountMinor).toBe(3000);
    expect(draft.grossExpenseAmountMinor).toBe(10000);
    expect(draft.incomeOffsetAmountMinor).toBe(7000);
    expect(draft.netDistributableAmountMinor).toBe(3000);
    expect(await observer.liquidationIncomeOffset.count({ where: { liquidationId: draft.id } })).toBe(1);
  }, 30000);

  it('D. shared income 6000/4000 allocates 4200/2800 across buildings', async () => {
    const ctx = await fixture('shared-60-40');
    const buildingA = await building(ctx.tenant.id, 'A');
    const buildingB = await building(ctx.tenant.id, 'B');
    await units(ctx.tenant.id, buildingA.id);
    await units(ctx.tenant.id, buildingB.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    await validatedExpense(ctx.tenant.id, buildingB.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      scopeType: MovementScope.TENANT_SHARED,
    });
    const fund = await observer.fund.create({
      data: {
        tenantId: ctx.tenant.id,
        scopeType: 'TENANT',
        type: 'RESERVE',
        name: `Fund D ${Date.now()}`,
        createdByMembershipId: ctx.membership.id,
      },
    });
    await allocateIncome(ctx.tenant.id, income.id, [
      { buildingId: buildingA.id, amountMinor: 6000 },
      { buildingId: buildingB.id, amountMinor: 4000 },
    ]);
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
      { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 },
    ]);

    const liqA = await liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
      buildingId: buildingA.id,
      period: '2026-08',
      baseCurrency: 'ARS',
    });
    const liqB = await liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
      buildingId: buildingB.id,
      period: '2026-08',
      baseCurrency: 'ARS',
    });

    expect(liqA.incomeOffsetAmountMinor).toBe(4200);
    expect(liqA.totalAmountMinor).toBe(5800);
    expect(liqB.incomeOffsetAmountMinor).toBe(2800);
    expect(liqB.totalAmountMinor).toBe(7200);

    const refs = await observer.liquidationIncomeOffset.findMany({
      where: { tenantId: ctx.tenant.id },
    });
    expect(refs.reduce((sum, ref) => sum + ref.valuedAmountMinor, 0)).toBe(7000);
  }, 30000);

  it('E. shared rounding is deterministic with odd allocation values', async () => {
    const ctx = await fixture('shared-rounding');
    const buildingA = await building(ctx.tenant.id, 'A');
    const buildingB = await building(ctx.tenant.id, 'B');
    await units(ctx.tenant.id, buildingA.id);
    await units(ctx.tenant.id, buildingB.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10001);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10001,
      scopeType: MovementScope.TENANT_SHARED,
    });
    await allocateIncome(ctx.tenant.id, income.id, [
      { buildingId: buildingA.id, amountMinor: 6000 },
      { buildingId: buildingB.id, amountMinor: 4000 },
    ]);
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 10001 },
    ]);

    const liqA = await liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
      buildingId: buildingA.id,
      period: '2026-08',
      baseCurrency: 'ARS',
    });
    expect(liqA.incomeOffsetAmountMinor).toBeGreaterThan(0);
    expect(liqA.incomeOffsetAmountMinor).toBeLessThanOrEqual(10001);

    // determinismo: cancelar el draft y repetir con el mismo estado → mismo resultado
    await liquidations.cancelLiquidation(ctx.tenant.id, liqA.id, ctx.membership.id);
    const liqA2 = await liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
      buildingId: buildingA.id,
      period: '2026-08',
      baseCurrency: 'ARS',
    });
    expect(liqA2.incomeOffsetAmountMinor).toBe(liqA.incomeOffsetAmountMinor);
  }, 30000);

  it('F. legacy nominal: same currency offset works', async () => {
    const ctx = await fixture('nominal-same-currency');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 7000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
    ]);

    const { draft } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);

    expect(draft.incomeOffsetAmountMinor).toBe(7000);
    expect(draft.totalAmountMinor).toBe(3000);
  }, 30000);

  it('G. legacy nominal: cross-currency offset rejected', async () => {
    const ctx = await fixture('nominal-cross-currency');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 7000,
      buildingId: buildingA.id,
      currencyCode: 'USD',
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000, currencyCode: 'USD' },
    ]);

    await expect(
      liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
        buildingId: buildingA.id,
        period: '2026-08',
        baseCurrency: 'ARS',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_INCOME_OFFSET_CURRENCY_MISMATCH' },
    });
  }, 30000);

  it('H. FUNCTIONAL: foreign income with frozen snapshot values exactly', async () => {
    const ctx = await fixture('functional-frozen');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 2500, {
      functionalAmountMinor: 2500,
      functionalCurrencyCode: 'ARS',
    });
    const incCat = await incomeCategory(ctx.tenant.id);
    const fx = await observer.exchangeRate.create({
      data: {
        tenantId: ctx.tenant.id,
        baseCurrency: 'USD',
        quoteCurrency: 'ARS',
        rate: '0.25',
        effectiveAt: new Date('2026-08-10T00:00:00.000Z'),
        source: 'fixture-fin06-h',
      },
    });
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
      currencyCode: 'USD',
      functionalAmountMinor: 2500,
      functionalCurrencyCode: 'ARS',
    });
    await observer.income.update({
      where: { id: income.id },
      data: {
        exchangeRateId: fx.id,
        exchangeRateValue: '0.25',
        exchangeRateDirection: 'INVERSE',
        exchangeRateEffectiveAt: new Date('2026-08-10T00:00:00.000Z'),
        conversionDate: new Date('2026-08-10T00:00:00.000Z'),
      },
    });
    const fund = await observer.fund.create({
      data: {
        tenantId: ctx.tenant.id,
        scopeType: 'TENANT',
        type: 'RESERVE',
        name: `Fund H ${Date.now()}`,
        createdByMembershipId: ctx.membership.id,
      },
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000, currencyCode: 'USD' },
      { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000, currencyCode: 'USD' },
    ]);

    const { draft } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);

    expect(draft.incomeOffsetAmountMinor).toBe(1750);
    expect(draft.totalAmountMinor).toBe(750);
  }, 30000);

  it('I. mutating live ExchangeRate after record does not change the liquidation', async () => {
    const ctx = await fixture('fx-frozen-proof');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 2500, {
      functionalAmountMinor: 2500,
      functionalCurrencyCode: 'ARS',
    });
    const incCat = await incomeCategory(ctx.tenant.id);

    const fx = await observer.exchangeRate.create({
      data: {
        tenantId: ctx.tenant.id,
        baseCurrency: 'USD',
        quoteCurrency: 'ARS',
        rate: '0.25',
        effectiveAt: new Date('2026-08-10T00:00:00.000Z'),
        source: 'fixture-fin06',
      },
    });

    const income = await observer.income.create({
      data: {
        tenantId: ctx.tenant.id,
        period: '2026-08',
        categoryId: incCat.id,
        amountMinor: 10000,
        currencyCode: 'USD',
        receivedDate: new Date('2026-08-10T00:00:00.000Z'),
        status: IncomeStatus.RECORDED,
        scopeType: MovementScope.BUILDING,
        buildingId: buildingA.id,
        functionalAmountMinor: 2500,
        functionalCurrencyCode: 'ARS',
        exchangeRateId: fx.id,
        exchangeRateValue: '0.25',
        exchangeRateDirection: 'INVERSE',
        exchangeRateEffectiveAt: new Date('2026-08-10T00:00:00.000Z'),
        conversionDate: new Date('2026-08-10T00:00:00.000Z'),
        createdByMembershipId: ctx.membership.id,
      },
    });
    const fund = await observer.fund.create({
      data: {
        tenantId: ctx.tenant.id,
        scopeType: 'TENANT',
        type: 'RESERVE',
        name: `Fund I ${Date.now()}`,
        createdByMembershipId: ctx.membership.id,
      },
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000, currencyCode: 'USD' },
      { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000, currencyCode: 'USD' },
    ]);

    const first = await liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
      buildingId: buildingA.id,
      period: '2026-08',
      baseCurrency: 'ARS',
    });
    expect(first.incomeOffsetAmountMinor).toBe(1750);

    // Cambiar el ExchangeRate live posterior: el resultado no debe cambiar.
    await observer.exchangeRate.update({
      where: { id: fx.id },
      data: { rate: '0.50' },
    });

    await liquidations.cancelLiquidation(ctx.tenant.id, first.id, ctx.membership.id);
    const second = await liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
      buildingId: buildingA.id,
      period: '2026-08',
      baseCurrency: 'ARS',
    });
    expect(second.incomeOffsetAmountMinor).toBe(1750);
  }, 30000);

  // ── H2. FUNCTIONAL fail-closed matrix (FIN-06R) ─────────────────────────

  async function setupFunctionalFailClosed(ctx: { tenant: { id: string }; membership: { id: string } }) {
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 2500, {
      functionalAmountMinor: 2500,
      functionalCurrencyCode: 'ARS',
    });
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
      currencyCode: 'USD',
    });
    return { buildingA, income };
  }

  it('H2.B. FUNCTIONAL: functionalAmountMinor NULL → 422, no liquidation, no references', async () => {
    const ctx = await fixture('func-null-amount');
    const { buildingA, income } = await setupFunctionalFailClosed(ctx);
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000, currencyCode: 'USD' },
    ]);

    await expect(
      liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
        buildingId: buildingA.id,
        period: '2026-08',
        baseCurrency: 'ARS',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED' },
    });

    expect(await observer.liquidation.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    expect(await observer.liquidationIncomeOffset.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
  }, 30000);

  it('H2.C. FUNCTIONAL: functionalCurrencyCode NULL → 422, no liquidation, no references', async () => {
    const ctx = await fixture('func-null-currency');
    const { buildingA, income } = await setupFunctionalFailClosed(ctx);
    await observer.income.update({
      where: { id: income.id },
      data: { functionalAmountMinor: 2500, functionalCurrencyCode: null },
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000, currencyCode: 'USD' },
    ]);

    await expect(
      liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
        buildingId: buildingA.id,
        period: '2026-08',
        baseCurrency: 'ARS',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED' },
    });

    expect(await observer.liquidation.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    expect(await observer.liquidationIncomeOffset.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
  }, 30000);

  it('H2.D. FUNCTIONAL: functionalCurrencyCode != baseCurrency → 422, no liquidation, no references', async () => {
    const ctx = await fixture('func-mismatch');
    const { buildingA, income } = await setupFunctionalFailClosed(ctx);
    await observer.income.update({
      where: { id: income.id },
      data: { functionalAmountMinor: 2500, functionalCurrencyCode: 'USD' },
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000, currencyCode: 'USD' },
    ]);

    await expect(
      liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
        buildingId: buildingA.id,
        period: '2026-08',
        baseCurrency: 'ARS',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED' },
    });

    expect(await observer.liquidation.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    expect(await observer.liquidationIncomeOffset.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
  }, 30000);

  // ── T2. Source drift matrix (FIN-06R) ───────────────────────────────────

  async function setupDriftDraft() {
    const ctx = await fixture('drift-matrix');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
    ]);
    const { reviewed } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);
    const reference = await observer.liquidationIncomeOffset.findFirstOrThrow({
      where: { tenantId: ctx.tenant.id },
    });
    const snapshot = (
      await observer.liquidation.findUniqueOrThrow({ where: { id: reviewed.id } })
    ).incomeOffsetSnapshot as unknown as Array<Record<string, unknown>>;
    return { ctx, buildingA, income, reviewed, reference, snapshot };
  }

  const driftMatrixCases: Array<{
    label: string;
    mutate: (ctx: Awaited<ReturnType<typeof setupDriftDraft>>) => Promise<void>;
  }> = [
    {
      label: '1. application destination OFFSET → CARRY',
      mutate: async ({ ctx, income }) => {
        await observer.incomeApplication.updateMany({
          where: { incomeId: income.id },
          data: { destinationType: IncomeApplicationDestination.CARRY_FORWARD },
        });
      },
    },
    {
      label: '2. application amount changes',
      mutate: async ({ ctx, income }) => {
        await observer.incomeApplication.updateMany({
          where: { incomeId: income.id },
          data: { amountMinor: 6500 },
        });
      },
    },
    {
      label: '3. application currency changes',
      mutate: async ({ ctx, income }) => {
        await observer.incomeApplication.updateMany({
          where: { incomeId: income.id },
          data: { currencyCode: 'USD' },
        });
      },
    },
    {
      label: '4. parent Income status changes',
      mutate: async ({ income }) => {
        await observer.income.update({
          where: { id: income.id },
          data: { status: IncomeStatus.VOID },
        });
      },
    },
    {
      label: '5. reference valuedAmount changes',
      mutate: async ({ reference }) => {
        await observer.liquidationIncomeOffset.update({
          where: { id: reference.id },
          data: { valuedAmountMinor: 6500 },
        });
      },
    },
    {
      label: '6. reference originalAmount changes',
      mutate: async ({ reference }) => {
        await observer.liquidationIncomeOffset.update({
          where: { id: reference.id },
          data: { originalAmountMinor: 6500 },
        });
      },
    },
    {
      label: '7. reference baseCurrency changes',
      mutate: async ({ reference }) => {
        await observer.liquidationIncomeOffset.update({
          where: { id: reference.id },
          data: { baseCurrency: 'USD' },
        });
      },
    },
    {
      label: '8. reference buildingId changes',
      mutate: async ({ ctx, reference, buildingA }) => {
        const other = await building(ctx.tenant.id, 'OTHER');
        await observer.liquidationIncomeOffset.update({
          where: { id: reference.id },
          data: { buildingId: other.id },
        });
      },
    },
    {
      label: '9. delete a reference row',
      mutate: async ({ reference }) => {
        await observer.liquidationIncomeOffset.delete({ where: { id: reference.id } });
      },
    },
    {
      label: '10. alter snapshot applicationAmountMinor',
      mutate: async ({ ctx, reviewed, reference, snapshot }) => {
        const updated = [...snapshot];
        updated[0] = { ...updated[0]!, applicationAmountMinor: 6500 };
        await observer.liquidation.update({
          where: { id: reviewed.id },
          data: { incomeOffsetSnapshot: updated as never },
        });
      },
    },
    {
      label: '11. alter snapshot valuedAmountMinor',
      mutate: async ({ ctx, reviewed, reference, snapshot }) => {
        const updated = [...snapshot];
        updated[0] = { ...updated[0]!, valuedAmountMinor: 6500 };
        await observer.liquidation.update({
          where: { id: reviewed.id },
          data: { incomeOffsetSnapshot: updated as never },
        });
      },
    },
    {
      label: '12. alter snapshot policyVersionId',
      mutate: async ({ ctx, reviewed, reference, snapshot }) => {
        const updated = [...snapshot];
        updated[0] = { ...updated[0]!, policyVersionId: 'corrupted-pv' };
        await observer.liquidation.update({
          where: { id: reviewed.id },
          data: { incomeOffsetSnapshot: updated as never },
        });
      },
    },
    {
      label: '13. alter incomeOffsetsByCurrency',
      mutate: async ({ ctx, reviewed }) => {
        await observer.liquidation.update({
          where: { id: reviewed.id },
          data: { incomeOffsetsByCurrency: { ARS: 1 } as never },
        });
      },
    },
  ];

  it.each(driftMatrixCases)(
    'T2. source drift — $label → 422 LIQUIDATION_INCOME_SOURCE_DRIFT, liquidation stays REVIEWED',
    async ({ mutate }) => {
      const setup = await setupDriftDraft();
      await mutate(setup);

      await expect(
        liquidations.publishLiquidation(setup.ctx.tenant.id, setup.reviewed.id, setup.ctx.membership.id, {
          dueDate: '2026-09-10',
        }),
      ).rejects.toMatchObject({
        response: { statusCode: 422, error: 'LIQUIDATION_INCOME_SOURCE_DRIFT' },
      });

      expect(
        await observer.liquidation.findUniqueOrThrow({ where: { id: setup.reviewed.id } }),
      ).toMatchObject({ status: 'REVIEWED' });
    },
    30000,
  );

  it('J. multiple offset incomes sum exactly with individual provenance', async () => {
    const ctx = await fixture('multiple-offsets');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 12000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income1 = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 5000,
      buildingId: buildingA.id,
    });
    const income2 = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 2000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income1.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 5000 },
    ]);
    await createOffsetApplications(ctx.tenant.id, income2.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 2000 },
    ]);

    const { draft } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);

    expect(draft.incomeOffsetAmountMinor).toBe(7000);
    expect(draft.totalAmountMinor).toBe(5000);
    const refs = await observer.liquidationIncomeOffset.findMany({
      where: { liquidationId: draft.id },
      orderBy: { incomeApplicationId: 'asc' },
    });
    expect(refs).toHaveLength(2);
    expect(refs.map((ref) => ref.originalAmountMinor).sort((a, b) => a - b)).toEqual([2000, 5000]);
  }, 30000);

  it('K. policy v1 application keeps policyVersionId in snapshot after v2 published', async () => {
    const ctx = await fixture('policy-provenance');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });

    const policy = await observer.incomePolicy.create({
      data: {
        tenantId: ctx.tenant.id,
        categoryId: incCat.id,
        createdByMembershipId: ctx.membership.id,
      },
    });
    const v1 = await observer.incomePolicyVersion.create({
      data: { policyId: policy.id, version: 1, createdByMembershipId: ctx.membership.id },
    });
    await observer.incomePolicyRule.create({
      data: {
        tenantId: ctx.tenant.id,
        versionId: v1.id,
        destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
        percentageBasisPoints: 10000,
        fundId: null,
      },
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000, policyVersionId: v1.id },
    ]);

    // Publicar v2: el snapshot del draft debe conservar policyVersionId v1.
    await observer.incomePolicyVersion.updateMany({
      where: { policyId: policy.id, status: 'ACTIVE' },
      data: { status: 'INACTIVE' },
    });
    const v2 = await observer.incomePolicyVersion.create({
      data: { policyId: policy.id, version: 2, createdByMembershipId: ctx.membership.id },
    });
    await observer.incomePolicyRule.create({
      data: {
        tenantId: ctx.tenant.id,
        versionId: v2.id,
        destinationType: IncomeApplicationDestination.CARRY_FORWARD,
        percentageBasisPoints: 10000,
        fundId: null,
      },
    });

    const { draft } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);

    expect(draft.incomeOffsetAmountMinor).toBe(7000);
    const liq = await observer.liquidation.findUniqueOrThrow({ where: { id: draft.id } });
    const snapshot = liq.incomeOffsetSnapshot as unknown as Array<{ policyVersionId: string | null }>;
    expect(snapshot[0]!.policyVersionId).toBe(v1.id);
  }, 30000);

  it('L. manual application (policyVersionId null) works identically', async () => {
    const ctx = await fixture('manual-application');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
    ]);

    const { draft } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);

    expect(draft.incomeOffsetAmountMinor).toBe(7000);
    const liq = await observer.liquidation.findUniqueOrThrow({ where: { id: draft.id } });
    const snapshot = liq.incomeOffsetSnapshot as unknown as Array<{ policyVersionId: string | null }>;
    expect(snapshot[0]!.policyVersionId).toBeNull();
  }, 30000);

  it('M. offset > gross rolls back without creating rows', async () => {
    const ctx = await fixture('offset-exceeds-gross');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 5000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
    ]);

    await expect(
      liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
        buildingId: buildingA.id,
        period: '2026-08',
        baseCurrency: 'ARS',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_INCOME_OFFSETS_EXCEED_GROSS' },
    });

    expect(await observer.liquidation.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    expect(await observer.liquidationIncomeOffset.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
  }, 30000);

  it('N. exact zero net: draft → review → publish with no positive charges', async () => {
    const ctx = await fixture('zero-net');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 10000 },
    ]);

    const { draft, reviewed } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);

    expect(draft.totalAmountMinor).toBe(0);
    expect(draft.netDistributableAmountMinor).toBe(0);

    const published = await liquidations.publishLiquidation(ctx.tenant.id, reviewed.id, ctx.membership.id, {
      dueDate: '2026-09-10',
    });
    expect(published.status).toBe('PUBLISHED');

    const charges = await observer.charge.findMany({ where: { liquidationId: published.id } });
    expect(charges).toHaveLength(0);

    const liq = await observer.liquidation.findUniqueOrThrow({ where: { id: published.id } });
    const snapshot = liq.publicationSnapshot as unknown as { version: number; netDistributableAmountMinor: number; allocations: Array<{ amountMinor: number }> };
    expect(snapshot.version).toBe(3);
    expect(snapshot.netDistributableAmountMinor).toBe(0);
    expect(snapshot.allocations.every((a) => a.amountMinor === 0)).toBe(true);
  }, 30000);

  it('O. draft vs void concurrency: serializable, no draft on voided income', async () => {
    const ctx = await fixture('draft-void-race');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
    ]);

    // Void primero → el draft no debe usar el income.
    await incomes.voidIncome(ctx.tenant.id, income.id, ctx.membership.id, roles);

    const draft = await liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
      buildingId: buildingA.id,
      period: '2026-08',
      baseCurrency: 'ARS',
    });

    expect(draft.incomeOffsetAmountMinor).toBe(0);
    expect(draft.totalAmountMinor).toBe(10000);
  }, 30000);

  it('P. DRAFT reference blocks void', async () => {
    const ctx = await fixture('draft-blocks-void');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
    ]);
    await liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
      buildingId: buildingA.id,
      period: '2026-08',
      baseCurrency: 'ARS',
    });

    await expect(
      incomes.voidIncome(ctx.tenant.id, income.id, ctx.membership.id, roles),
    ).rejects.toThrow(ConflictException);
  }, 30000);

  it('Q. cancel then void succeeds', async () => {
    const ctx = await fixture('cancel-then-void');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
    ]);
    const { draft } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);

    await liquidations.cancelLiquidation(ctx.tenant.id, draft.id, ctx.membership.id);

    const result = await incomes.voidIncome(ctx.tenant.id, income.id, ctx.membership.id, roles);
    expect(result.status).toBe('VOID');
  }, 30000);

  it('R. publish then void is rejected permanently; snapshot and charges intact', async () => {
    const ctx = await fixture('publish-then-void');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
    ]);
    const { reviewed } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);
    await liquidations.publishLiquidation(ctx.tenant.id, reviewed.id, ctx.membership.id, {
      dueDate: '2026-09-10',
    });

    await expect(
      incomes.voidIncome(ctx.tenant.id, income.id, ctx.membership.id, roles),
    ).rejects.toThrow(ConflictException);

    const liq = await observer.liquidation.findUniqueOrThrow({ where: { id: reviewed.id } });
    expect(liq.status).toBe('PUBLISHED');
    expect(liq.publicationSnapshot).not.toBeNull();
    expect(await observer.charge.count({ where: { liquidationId: reviewed.id } })).toBe(2);
  }, 30000);

  it('S. mixed OFFSET+FUND: published offset blocks whole void, Fund ledger untouched', async () => {
    const ctx = await fixture('mixed-void');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });
    const fund = await observer.fund.create({
      data: {
        tenantId: ctx.tenant.id,
        scopeType: 'TENANT',
        type: 'RESERVE',
        name: `Fund S ${Date.now()}`,
        createdByMembershipId: ctx.membership.id,
      },
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
      { destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 3000 },
    ]);

    // Aplicar la política manualmente no aplica; publicar el plan con createPlan no existe
    // aquí — usamos applyPolicy del servicio para crear el CREDIT del FUND.
    const { reviewed } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);
    await liquidations.publishLiquidation(ctx.tenant.id, reviewed.id, ctx.membership.id, {
      dueDate: '2026-09-10',
    });

    const fundTxBefore = await observer.fundTransaction.count({ where: { tenantId: ctx.tenant.id } });

    await expect(
      incomes.voidIncome(ctx.tenant.id, income.id, ctx.membership.id, roles),
    ).rejects.toThrow(ConflictException);

    expect(await observer.fundTransaction.count({ where: { tenantId: ctx.tenant.id } })).toBe(fundTxBefore);
  }, 30000);

  it('T. publication source drift: manual corruption blocks publish', async () => {
    const ctx = await fixture('source-drift');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
    ]);
    const { reviewed } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);

    // Corrupción controlada en DB disposable: la aplicación ya no es OFFSET.
    await observer.incomeApplication.updateMany({
      where: { incomeId: income.id },
      data: { destinationType: IncomeApplicationDestination.CARRY_FORWARD, fundId: null },
    });

    await expect(
      liquidations.publishLiquidation(ctx.tenant.id, reviewed.id, ctx.membership.id, {
        dueDate: '2026-09-10',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_INCOME_SOURCE_DRIFT' },
    });

    expect(
      await observer.liquidation.findUniqueOrThrow({ where: { id: reviewed.id } }),
    ).toMatchObject({ status: 'REVIEWED' });
  }, 30000);

  it('U. duplicate same liquidation/application reference rejected by DB', async () => {
    const ctx = await fixture('dup-reference');
    const buildingA = await building(ctx.tenant.id, 'A');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, cat.id, { amountMinor: 1000 });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 1000 },
    ]);
    const liq = await observer.liquidation.create({
      data: {
        tenantId: ctx.tenant.id,
        buildingId: buildingA.id,
        period: '2026-08',
        baseCurrency: 'ARS',
        totalAmountMinor: 0,
        totalsByCurrency: { ARS: 0 },
        expenseSnapshot: [],
        unitCount: 1,
        generatedByMembershipId: ctx.membership.id,
      },
    });
    const app = await observer.incomeApplication.findFirstOrThrow({ where: { incomeId: income.id } });
    const base = {
      tenantId: ctx.tenant.id,
      liquidationId: liq.id,
      incomeApplicationId: app.id,
      buildingId: buildingA.id,
      originalAmountMinor: 1000,
      currencyCode: 'ARS',
      valuedAmountMinor: 1000,
      baseCurrency: 'ARS',
    };
    await observer.liquidationIncomeOffset.create({ data: base });

    await expect(observer.liquidationIncomeOffset.create({ data: base })).rejects.toThrow(/unique|duplicate/i);
  }, 20000);

  it('V. tenant isolation: cross-tenant income never offsets', async () => {
    const ctxA = await fixture('iso-a');
    const ctxB = await fixture('iso-b');
    const buildingA = await building(ctxA.tenant.id, 'A');
    await units(ctxA.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctxA.tenant.id);
    await validatedExpense(ctxA.tenant.id, buildingA.id, expCat.id, 10000);
    const incCatB = await incomeCategory(ctxB.tenant.id);
    const incomeB = await recordedIncome(ctxB.tenant.id, ctxB.membership.id, incCatB.id, {
      amountMinor: 7000,
      buildingId: buildingA.id, // building del tenant A pero income del tenant B
    });
    await createOffsetApplications(ctxB.tenant.id, incomeB.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
    ]);

    const { draft } = await createLiquidationFlow(ctxA.tenant.id, buildingA.id, ctxA.membership.id);

    expect(draft.incomeOffsetAmountMinor).toBe(0);
    expect(draft.totalAmountMinor).toBe(10000);
    expect(await observer.liquidationIncomeOffset.count({ where: { tenantId: ctxA.tenant.id } })).toBe(0);
  }, 30000);

  it('W. leaves no leftovers after the suite', async () => {
    const leftover = await observer.tenant.count({ where: { name: { startsWith: `${fixturePhase}-` } } });
    expect(leftover).toBe(0);
  }, 10000);

  // ── R2. Building eligibility before FUNCTIONAL validation (PG) ──────────

  it('R2.A. unrelated BUILDING income with invalid FUNCTIONAL snapshot does not block this building', async () => {
    const ctx = await fixture('r2-building-isolation');
    const buildingA = await building(ctx.tenant.id, 'A');
    const buildingB = await building(ctx.tenant.id, 'B');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 2500, {
      functionalAmountMinor: 2500,
      functionalCurrencyCode: 'ARS',
    });
    const incCat = await incomeCategory(ctx.tenant.id);
    // Income en Building B con OFFSET y snapshot funcional NULL (inválido).
    const incomeB = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingB.id,
      currencyCode: 'USD',
      functionalAmountMinor: null,
    });
    await createOffsetApplications(ctx.tenant.id, incomeB.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000, currencyCode: 'USD' },
    ]);

    const { draft } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);

    expect(draft.incomeOffsetAmountMinor).toBe(0);
    expect(draft.totalAmountMinor).toBe(2500);
  }, 30000);

  it('R2.B. TENANT_SHARED income allocated only to Building B with invalid snapshot does not block Building A', async () => {
    const ctx = await fixture('r2-shared-isolation');
    const buildingA = await building(ctx.tenant.id, 'A');
    const buildingB = await building(ctx.tenant.id, 'B');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 2500, {
      functionalAmountMinor: 2500,
      functionalCurrencyCode: 'ARS',
    });
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      scopeType: MovementScope.TENANT_SHARED,
      currencyCode: 'USD',
      functionalAmountMinor: null,
    });
    await allocateIncome(ctx.tenant.id, income.id, [
      { buildingId: buildingB.id, amountMinor: 10000 },
    ]);
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000, currencyCode: 'USD' },
    ]);

    const { draft } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);

    expect(draft.incomeOffsetAmountMinor).toBe(0);
    expect(draft.totalAmountMinor).toBe(2500);
  }, 30000);

  it('R2.C. TENANT_SHARED income with Building A share > 0 and invalid snapshot rejects 422', async () => {
    const ctx = await fixture('r2-shared-relevant');
    const buildingA = await building(ctx.tenant.id, 'A');
    const buildingB = await building(ctx.tenant.id, 'B');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 2500, {
      functionalAmountMinor: 2500,
      functionalCurrencyCode: 'ARS',
    });
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      scopeType: MovementScope.TENANT_SHARED,
      currencyCode: 'USD',
      functionalAmountMinor: null,
    });
    await allocateIncome(ctx.tenant.id, income.id, [
      { buildingId: buildingA.id, amountMinor: 6000 },
      { buildingId: buildingB.id, amountMinor: 4000 },
    ]);
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000, currencyCode: 'USD' },
    ]);

    await expect(
      liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
        buildingId: buildingA.id,
        period: '2026-08',
        baseCurrency: 'ARS',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED' },
    });

    expect(await observer.liquidation.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
  }, 30000);

  // ── R2. Zero-offset V3 lifecycle ─────────────────────────────────────────

  it('R2.D. zero-offset FIN-06 draft publishes V3 with empty offsets and correct audit', async () => {
    const ctx = await fixture('r2-zero-offset-v3');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);

    const { draft, reviewed } = await createLiquidationFlow(ctx.tenant.id, buildingA.id, ctx.membership.id);

    expect(draft.grossExpenseAmountMinor).toBe(10000);
    expect(draft.adjustmentAmountMinor).toBe(0);
    expect(draft.preIncomeAmountMinor).toBe(10000);
    expect(draft.incomeOffsetAmountMinor).toBe(0);
    expect(draft.netDistributableAmountMinor).toBe(10000);
    expect(draft.totalAmountMinor).toBe(10000);

    const draftRow = await observer.liquidation.findUniqueOrThrow({ where: { id: draft.id } });
    expect(draftRow.incomeOffsetSnapshot).toEqual([]);
    expect(draftRow.incomeOffsetsByCurrency).toEqual({});

    const published = await liquidations.publishLiquidation(ctx.tenant.id, reviewed.id, ctx.membership.id, {
      dueDate: '2026-09-10',
    });
    expect(published.status).toBe('PUBLISHED');

    const row = await observer.liquidation.findUniqueOrThrow({ where: { id: published.id } });
    const snapshot = row.publicationSnapshot as unknown as {
      version: number;
      incomeOffsets: unknown[];
      incomeOffsetsByCurrency: Record<string, number>;
      totalAmountMinor: number;
    };
    expect(snapshot.version).toBe(3);
    expect(snapshot.incomeOffsets).toEqual([]);
    expect(snapshot.incomeOffsetsByCurrency).toEqual({});
    expect(snapshot.totalAmountMinor).toBe(10000);

    const charges = await observer.charge.findMany({ where: { liquidationId: published.id } });
    expect(charges).toHaveLength(2);
    expect(charges.reduce((sum, c) => sum + c.amount, 0)).toBe(10000);

    const audit = await observer.auditLog.findFirst({
      where: { tenantId: ctx.tenant.id, action: 'LIQUIDATION_PUBLISH' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    const metadata = audit!.metadata as Record<string, unknown>;
    expect(metadata.snapshotVersion).toBe(3);
    expect(metadata.incomeOffsetCount).toBe(0);
  }, 30000);

  // ── R2. Tamper bypass / classification tests ─────────────────────────────

  async function setupFin06WithOffsets() {
    const ctx = await fixture('r2-tamper');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await recordedIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      buildingId: buildingA.id,
    });
    await createOffsetApplications(ctx.tenant.id, income.id, [
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 3000 },
    ]);
    // Draft en estado DRAFT (inmutable solo desde REVIEWED por trigger de la DB).
    const draft = await liquidations.createDraft(ctx.tenant.id, ctx.membership.id, {
      buildingId: buildingA.id,
      period: '2026-08',
      baseCurrency: 'ARS',
    });
    expect(draft.incomeOffsetAmountMinor).toBe(3000);
    const reference = await observer.liquidationIncomeOffset.findFirstOrThrow({
      where: { tenantId: ctx.tenant.id },
    });
    expect(reference).toBeDefined();
    return { ctx, buildingA, draft, reference };
  }

  async function corruptAndReview(setup: Awaited<ReturnType<typeof setupFin06WithOffsets>>, data: Record<string, unknown>) {
    await observer.liquidation.update({
      where: { id: setup.draft.id },
      data,
    });
    const reviewed = await liquidations.reviewLiquidation(setup.ctx.tenant.id, setup.draft.id, setup.ctx.membership.id);
    return { ...setup, reviewed };
  }

  it('R2.E. offset→0 consistent tamper (equation-valid) is rejected, never V2', async () => {
    const setup = await setupFin06WithOffsets();

    // Corrupción CONSISTENTE: offset 0, net 10000, total 10000 (equations OK).
    const { reviewed } = await corruptAndReview(setup, {
      incomeOffsetAmountMinor: 0,
      netDistributableAmountMinor: 10000,
      totalAmountMinor: 10000,
    });

    await expect(
      liquidations.publishLiquidation(setup.ctx.tenant.id, reviewed.id, setup.ctx.membership.id, {
        dueDate: '2026-09-10',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_INCOME_SOURCE_DRIFT' },
    });

    const row = await observer.liquidation.findUniqueOrThrow({ where: { id: reviewed.id } });
    expect(row.status).toBe('REVIEWED');
    expect(row.publicationSnapshot).toBeNull();
    expect(await observer.charge.count({ where: { liquidationId: reviewed.id } })).toBe(0);
  }, 30000);

  it('R2.F. all-summary-null with artifacts intact is rejected, never legacy', async () => {
    const setup = await setupFin06WithOffsets();

    // Todos los summary FIN-06 a NULL (la rama legacy-null del CHECK permite esto),
    // pero los artifacts (snapshot JSON + relational refs) permanecen.
    const { reviewed } = await corruptAndReview(setup, {
      grossExpenseAmountMinor: null,
      adjustmentAmountMinor: null,
      preIncomeAmountMinor: null,
      incomeOffsetAmountMinor: null,
      netDistributableAmountMinor: null,
    });

    await expect(
      liquidations.publishLiquidation(setup.ctx.tenant.id, reviewed.id, setup.ctx.membership.id, {
        dueDate: '2026-09-10',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_INCOME_SOURCE_DRIFT' },
    });

    expect(
      await observer.liquidation.findUniqueOrThrow({ where: { id: reviewed.id } }),
    ).toMatchObject({ status: 'REVIEWED' });
  }, 30000);

  it('R2.G. missing incomeOffsetSnapshot artifact is rejected', async () => {
    const setup = await setupFin06WithOffsets();

    const { reviewed } = await corruptAndReview(setup, { incomeOffsetSnapshot: null });

    await expect(
      liquidations.publishLiquidation(setup.ctx.tenant.id, reviewed.id, setup.ctx.membership.id, {
        dueDate: '2026-09-10',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_INCOME_SOURCE_DRIFT' },
    });

    expect(
      await observer.liquidation.findUniqueOrThrow({ where: { id: reviewed.id } }),
    ).toMatchObject({ status: 'REVIEWED' });
  }, 30000);

  it('R2.H. missing incomeOffsetsByCurrency artifact is rejected', async () => {
    const setup = await setupFin06WithOffsets();

    const { reviewed } = await corruptAndReview(setup, { incomeOffsetsByCurrency: null });

    await expect(
      liquidations.publishLiquidation(setup.ctx.tenant.id, reviewed.id, setup.ctx.membership.id, {
        dueDate: '2026-09-10',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_INCOME_SOURCE_DRIFT' },
    });

    expect(
      await observer.liquidation.findUniqueOrThrow({ where: { id: reviewed.id } }),
    ).toMatchObject({ status: 'REVIEWED' });
  }, 30000);

  it('R2.I. zero-offset with unexpected reference or snapshot items is rejected', async () => {
    const setup = await setupFin06WithOffsets();

    // Draft legítimo con offset 3000, pero corrompemos el summary a offset 0
    // manteniendo snapshot con items y reference: debe rechazar.
    const { reviewed } = await corruptAndReview(setup, {
      incomeOffsetAmountMinor: 0,
      netDistributableAmountMinor: 10000,
      totalAmountMinor: 10000,
    });

    await expect(
      liquidations.publishLiquidation(setup.ctx.tenant.id, reviewed.id, setup.ctx.membership.id, {
        dueDate: '2026-09-10',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_INCOME_SOURCE_DRIFT' },
    });

    expect(
      await observer.liquidation.findUniqueOrThrow({ where: { id: reviewed.id } }),
    ).toMatchObject({ status: 'REVIEWED' });
  }, 30000);
});
