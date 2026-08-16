import { UnprocessableEntityException } from '@nestjs/common';
import {
  FundStatus,
  FundType,
  IncomeApplicationDestination,
  IncomeDestination,
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
import { LegacyIncomeBackfillService, LEGACY_BACKFILL_LIQUIDATION_CONFLICT } from './legacy-income-backfill.service';
import { IncomesService } from './incomes.service';
import { IncomeApplicationsService } from './income-applications.service';
import { FundsService } from './funds.service';
import { CurrencyConversionService } from './currency-conversion.service';
import { MovementAllocationService } from './movement-allocation.service';
import {
  createLiquidationWorkflowDependencies,
  LiquidationPublicationUseCase,
} from './liquidation-publication.use-case';

const ACCEPTANCE_DATABASES = new Set(['buildingos_fin04_acceptance']);
const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
const fixturePhase = 'fin04';
const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  expectedDatabaseName !== undefined &&
  ACCEPTANCE_DATABASES.has(expectedDatabaseName);
const describePostgres = enabled ? describe : describe.skip;

describePostgres('FIN-04 legacy income backfill (PostgreSQL)', () => {
  let observer: PrismaClient;
  let backfill: LegacyIncomeBackfillService;
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
    const validators = new FinanzasValidators(prisma, new ResidentAccessService(prisma));
    const notifications = { createNotification: () => Promise.resolve({ id: 'n' }) } as unknown as NotificationsService;
    const useCase = new LiquidationPublicationUseCase(
      createLiquidationWorkflowDependencies({ prisma, auditService: audit, validators, notificationsService: notifications }),
    );
    const appsSvc = new IncomeApplicationsService(prisma, audit, validators);
    return {
      backfill: new LegacyIncomeBackfillService(prisma, audit, validators, appsSvc),
      liquidations: new LiquidationsService(
        prisma,
        audit,
        validators,
        useCase,
        new LiquidationIncomeOffsetsService(prisma),
        new LegacyIncomeBackfillService(prisma, audit, validators, appsSvc),
      ),
      incomes: new IncomesService(prisma, audit, validators, new MovementAllocationService(prisma, audit, validators), new CurrencyConversionService(prisma)),
      apps: appsSvc,
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
    backfill = svc.backfill;
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
      data: { name: `${fixturePhase}-${label}-${suffix}`, type: TenantType.ADMINISTRADORA, functionalCurrency: 'ARS' },
    });
    tenantIds.push(tenant.id);
    const user = await observer.user.create({
      data: { email: `${fixturePhase}-${suffix}@buildingos.local`, name: `${fixturePhase} ${label}`, passwordHash: 'test' },
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
      data: { tenantId, name: `B ${label} ${Date.now()}`, alias: `B-${label}-${Date.now().toString(36)}` },
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
    return observer.expenseLedgerCategory.create({ data: { tenantId, name: `Inc ${Date.now()}`, movementType: 'INCOME' } });
  }

  async function expenseCategory(tenantId: string) {
    return observer.expenseLedgerCategory.create({ data: { tenantId, name: `Exp ${Date.now()}`, movementType: 'EXPENSE' } });
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

  async function legacyIncome(
    tenantId: string,
    membershipId: string,
    categoryId: string,
    params: {
      amountMinor: number;
      destination: IncomeDestination;
      period?: string;
      buildingId?: string | null;
      scopeType?: MovementScope;
      currencyCode?: string;
      receivedDate?: Date;
      status?: IncomeStatus;
      functionalAmountMinor?: number | null;
      functionalCurrencyCode?: string | null;
    },
  ) {
    return observer.income.create({
      data: {
        tenantId,
        period: params.period ?? '2026-08',
        categoryId,
        amountMinor: params.amountMinor,
        currencyCode: params.currencyCode ?? 'ARS',
        receivedDate: params.receivedDate ?? new Date('2026-08-10T00:00:00.000Z'),
        status: params.status ?? IncomeStatus.RECORDED,
        scopeType: params.scopeType ?? MovementScope.BUILDING,
        buildingId: params.buildingId ?? null,
        destination: params.destination,
        functionalAmountMinor: params.functionalAmountMinor ?? null,
        functionalCurrencyCode: params.functionalCurrencyCode ?? null,
        createdByMembershipId: membershipId,
      },
    });
  }

  async function allocateIncome(tenantId: string, incomeId: string, allocations: Array<{ buildingId: string; amountMinor: number }>) {
    await observer.movementAllocation.createMany({
      data: allocations.map((a) => ({ tenantId, incomeId, buildingId: a.buildingId, amountMinor: a.amountMinor })),
    });
  }

  async function createDraftFor(tenantId: string, buildingId: string, membershipId: string, period = '2026-08') {
    return liquidations.createDraft(tenantId, membershipId, { buildingId, period, baseCurrency: 'ARS' });
  }

  // ── A. DB provenance CHECK ───────────────────────────────────────────────

  it('A. policy + legacy provenance are mutually exclusive at the DB level', async () => {
    const ctx = await fixture('provenance-check');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, cat.id, {
      amountMinor: 1000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
    });
    const policy = await observer.incomePolicy.create({
      data: { tenantId: ctx.tenant.id, categoryId: cat.id, createdByMembershipId: ctx.membership.id },
    });
    const version = await observer.incomePolicyVersion.create({
      data: { policyId: policy.id, version: 1, createdByMembershipId: ctx.membership.id },
    });

    await expect(
      observer.incomeApplication.create({
        data: {
          tenantId: ctx.tenant.id,
          incomeId: income.id,
          destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
          amountMinor: 1000,
          currencyCode: 'ARS',
          createdByMembershipId: ctx.membership.id,
          policyVersionId: version.id,
          legacyDestination: IncomeDestination.APPLY_TO_EXPENSES,
        },
      }),
    ).rejects.toThrow(/check constraint|Check/);
  }, 20000);

  it('A2. legacy mapping CHECK rejects inconsistent destination/fund combinations', async () => {
    const ctx = await fixture('mapping-check');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, cat.id, {
      amountMinor: 1000,
      destination: IncomeDestination.RESERVE_FUND,
    });

    // APPLY legacy con fundId → CHECK violado
    await expect(
      observer.incomeApplication.create({
        data: {
          tenantId: ctx.tenant.id,
          incomeId: income.id,
          destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
          fundId: 'fund-x',
          amountMinor: 1000,
          currencyCode: 'ARS',
          createdByMembershipId: ctx.membership.id,
          legacyDestination: IncomeDestination.APPLY_TO_EXPENSES,
        },
      }),
    ).rejects.toThrow(/check constraint|Check/);

    // RESERVE legacy sin fundId → CHECK violado
    await expect(
      observer.incomeApplication.create({
        data: {
          tenantId: ctx.tenant.id,
          incomeId: income.id,
          destinationType: IncomeApplicationDestination.FUND,
          amountMinor: 1000,
          currencyCode: 'ARS',
          createdByMembershipId: ctx.membership.id,
          legacyDestination: IncomeDestination.RESERVE_FUND,
        },
      }),
    ).rejects.toThrow(/check constraint|Check/);
  }, 20000);

  it('B. tenant hard-delete lifecycle removes backfilled applications', async () => {
    const ctx = await fixture('fk-lifecycle');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, cat.id, {
      amountMinor: 1000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
    });
    const result = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [{ incomeId: income.id }]);
    expect(result[0]!.status).toBe('MIGRATED');

    await observer.tenant.delete({ where: { id: ctx.tenant.id } });

    expect(await observer.incomeApplication.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    tenantIds.splice(tenantIds.indexOf(ctx.tenant.id), 1);
    membershipIds.splice(membershipIds.indexOf(ctx.membership.id), 1);
    userIds.splice(userIds.indexOf(ctx.userId), 1);
  }, 30000);

  // ── C. Lazy materialization ─────────────────────────────────────────────

  it('C. lazy materializes APPLY legacy and FIN-06 consumes the real application', async () => {
    const ctx = await fixture('lazy-apply');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 3000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      buildingId: buildingA.id,
    });

    const draft = await createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id);

    expect(draft.incomeOffsetAmountMinor).toBe(3000);
    expect(draft.netDistributableAmountMinor).toBe(7000);

    // La aplicación legacy es REAL y persistida.
    const app = await observer.incomeApplication.findFirstOrThrow({ where: { incomeId: income.id } });
    expect(app.destinationType).toBe(IncomeApplicationDestination.OFFSET_EXPENSES);
    expect(app.legacyDestination).toBe(IncomeDestination.APPLY_TO_EXPENSES);
    expect(app.amountMinor).toBe(3000);

    // Reference relacional FIN-06 creada.
    expect(await observer.liquidationIncomeOffset.count({ where: { liquidationId: draft.id } })).toBe(1);

    // Audit de backfill con mode LIQUIDATION_AUTO_MATERIALIZE.
    const audit = await observer.auditLog.findFirst({
      where: { tenantId: ctx.tenant.id, action: 'INCOME_LEGACY_BACKFILL' },
    });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as Record<string, unknown>).mode).toBe('LIQUIDATION_AUTO_MATERIALIZE');
  }, 30000);

  it('D. lazy application rolls back when the draft fails (offset > gross)', async () => {
    const ctx = await fixture('lazy-rollback');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 5000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 6000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      buildingId: buildingA.id,
    });

    await expect(createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id)).rejects.toMatchObject({
      response: { statusCode: 422, error: 'LIQUIDATION_INCOME_OFFSETS_EXCEED_GROSS' },
    });

    // Rollback completo: sin application legacy, sin audit, sin liquidation.
    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(0);
    expect(await observer.auditLog.count({ where: { tenantId: ctx.tenant.id, action: 'INCOME_LEGACY_BACKFILL' } })).toBe(0);
    expect(await observer.liquidation.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
  }, 30000);

  it('E. existing modern plan wins over legacy destination', async () => {
    const ctx = await fixture('modern-wins');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      buildingId: buildingA.id,
    });

    // Plan manual 100% FUND (aunque destination = APPLY).
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `F ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });
    await apps.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
      applications: [{ destinationType: IncomeApplicationDestination.FUND, fundId: fund.id, amountMinor: 10000 }],
    });

    const draft = await createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id);

    // FUND no reduce liquidación; fallback OFFSET NO se ejecuta.
    expect(draft.incomeOffsetAmountMinor).toBe(0);
    const appCount = await observer.incomeApplication.count({ where: { incomeId: income.id } });
    expect(appCount).toBe(1);
  }, 30000);

  it('F. shared legacy materializes ONE application; shares split across buildings', async () => {
    const ctx = await fixture('shared-one-app');
    const buildingA = await building(ctx.tenant.id, 'A');
    const buildingB = await building(ctx.tenant.id, 'B');
    await units(ctx.tenant.id, buildingA.id);
    await units(ctx.tenant.id, buildingB.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    await validatedExpense(ctx.tenant.id, buildingB.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      scopeType: MovementScope.TENANT_SHARED,
    });
    await allocateIncome(ctx.tenant.id, income.id, [
      { buildingId: buildingA.id, amountMinor: 6000 },
      { buildingId: buildingB.id, amountMinor: 4000 },
    ]);

    const draftA = await createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id);
    expect(draftA.incomeOffsetAmountMinor).toBe(6000);
    await liquidations.cancelLiquidation(ctx.tenant.id, draftA.id, ctx.membership.id);

    const draftB = await createDraftFor(ctx.tenant.id, buildingB.id, ctx.membership.id);
    expect(draftB.incomeOffsetAmountMinor).toBe(4000);

    // UNA sola aplicación, no dos.
    const appCount = await observer.incomeApplication.count({ where: { incomeId: income.id } });
    expect(appCount).toBe(1);
    const refs = await observer.liquidationIncomeOffset.findMany({
      where: { tenantId: ctx.tenant.id },
    });
    expect(refs.reduce((sum, r) => sum + r.valuedAmountMinor, 0)).toBe(10000);
  }, 30000);

  it('G. shared historical conflict blocks auto-materialization', async () => {
    const ctx = await fixture('shared-conflict');
    const buildingA = await building(ctx.tenant.id, 'A');
    const buildingB = await building(ctx.tenant.id, 'B');
    await units(ctx.tenant.id, buildingA.id);
    await units(ctx.tenant.id, buildingB.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    await validatedExpense(ctx.tenant.id, buildingB.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);

    // Publicar liquidation A ANTES de que exista el shared legacy.
    const draftA = await createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id);
    const reviewedA = await liquidations.reviewLiquidation(ctx.tenant.id, draftA.id, ctx.membership.id);
    await liquidations.publishLiquidation(ctx.tenant.id, reviewedA.id, ctx.membership.id, { dueDate: '2026-09-10' });

    // El shared legacy aparece después (históricamente ambiguo).
    const shared = await legacyIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      scopeType: MovementScope.TENANT_SHARED,
    });
    await allocateIncome(ctx.tenant.id, shared.id, [
      { buildingId: buildingA.id, amountMinor: 6000 },
      { buildingId: buildingB.id, amountMinor: 4000 },
    ]);

    // Intentar liquidation B → conflicto histórico del shared (A ya publicada).
    await expect(createDraftFor(ctx.tenant.id, buildingB.id, ctx.membership.id)).rejects.toMatchObject({
      response: { statusCode: 422, error: LEGACY_BACKFILL_LIQUIDATION_CONFLICT },
    });

    // No se creó application parcial para el shared.
    expect(await observer.incomeApplication.count({ where: { incomeId: shared.id } })).toBe(0);
  }, 30000);

  it('H. DRAFT liquidation conflict blocks explicit backfill', async () => {
    const ctx = await fixture('draft-conflict');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);

    // Draft A activo creado ANTES del legacy income (snapshot congelado sin él).
    const draftA = await createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id);

    const legacy = await legacyIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 3000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      buildingId: buildingA.id,
    });

    // Backfill explícito → conflicto (draft A activo del mismo período).
    const result = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [{ incomeId: legacy.id }]);
    expect(result[0]!.status).toBe('LIQUIDATION_CONFLICT');
    expect(await observer.incomeApplication.count({ where: { incomeId: legacy.id } })).toBe(0);

    // Cancelar el draft → ahora sí puede materializarse.
    await liquidations.cancelLiquidation(ctx.tenant.id, draftA.id, ctx.membership.id);
    const after = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [{ incomeId: legacy.id }]);
    expect(after[0]!.status).toBe('MIGRATED');
  }, 30000);

  it('I. REVIEWED liquidation conflict blocks explicit backfill', async () => {
    const ctx = await fixture('reviewed-conflict');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);

    const draftA = await createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id);
    await liquidations.reviewLiquidation(ctx.tenant.id, draftA.id, ctx.membership.id);

    const legacy = await legacyIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 3000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      buildingId: buildingA.id,
    });

    const result = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [{ incomeId: legacy.id }]);
    expect(result[0]!.status).toBe('LIQUIDATION_CONFLICT');
    expect(await observer.incomeApplication.count({ where: { incomeId: legacy.id } })).toBe(0);
  }, 30000);

  it('J. CANCELED liquidation does not block materialization', async () => {
    const ctx = await fixture('canceled-ok');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);

    const draftA = await createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id);
    await liquidations.cancelLiquidation(ctx.tenant.id, draftA.id, ctx.membership.id);

    const legacy = await legacyIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 3000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      buildingId: buildingA.id,
    });

    const draft2 = await createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id);
    expect(draft2.incomeOffsetAmountMinor).toBe(3000);
    expect(await observer.incomeApplication.count({ where: { incomeId: legacy.id } })).toBe(1);
  }, 30000);

  // ── K. Explicit Fund backfill ────────────────────────────────────────────

  it('K. RESERVE explicit backfill: application + real Fund CREDIT with occurredAt = receivedDate', async () => {
    const ctx = await fixture('reserve-explicit');
    const cat = await incomeCategory(ctx.tenant.id);
    const receivedDate = new Date('2026-03-15T00:00:00.000Z');
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, cat.id, {
      amountMinor: 5000,
      destination: IncomeDestination.RESERVE_FUND,
      currencyCode: 'USD',
      receivedDate,
    });
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `R ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });

    const result = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [
      { incomeId: income.id, fundId: fund.id },
    ]);
    expect(result[0]!.status).toBe('MIGRATED');

    const app = await observer.incomeApplication.findFirstOrThrow({ where: { incomeId: income.id } });
    expect(app.destinationType).toBe(IncomeApplicationDestination.FUND);
    expect(app.fundId).toBe(fund.id);
    expect(app.legacyDestination).toBe(IncomeDestination.RESERVE_FUND);
    expect(app.amountMinor).toBe(5000);
    expect(app.currencyCode).toBe('USD');

    const tx = await observer.fundTransaction.findFirstOrThrow({ where: { fundId: fund.id, direction: 'CREDIT' } });
    expect(tx.amountMinor).toBe(5000);
    expect(tx.currencyCode).toBe('USD');
    expect(tx.occurredAt.toISOString()).toBe(receivedDate.toISOString()); // histórico, no hoy
    expect(tx.incomeApplicationId).toBe(app.id);

    const balance = await observer.fundTransaction.aggregate({
      where: { fundId: fund.id, direction: 'CREDIT', reversalOfTransactionId: null },
      _sum: { amountMinor: true },
    });
    expect(balance._sum.amountMinor).toBe(5000);

    // Audits requeridos (tenant-scoped; FUND_TRANSACTION_CREATE usa entityId = tx.id).
    const actions = await observer.auditLog.findMany({
      where: { tenantId: ctx.tenant.id },
      select: { action: true },
    });
    const actionSet = new Set(actions.map((a) => a.action));
    expect(actionSet.has('INCOME_APPLICATIONS_CREATE')).toBe(true);
    expect(actionSet.has('FUND_TRANSACTION_CREATE')).toBe(true);
    expect(actionSet.has('INCOME_LEGACY_BACKFILL')).toBe(true);

    // Retry idempotente.
    const retry = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [
      { incomeId: income.id, fundId: fund.id },
    ]);
    expect(retry[0]!.status).toBe('ALREADY_MIGRATED');
    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(1);
    expect(await observer.fundTransaction.count({ where: { fundId: fund.id, direction: 'CREDIT' } })).toBe(1);
  }, 30000);

  it('L. SPECIAL explicit backfill works with a SPECIAL fund', async () => {
    const ctx = await fixture('special-explicit');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, cat.id, {
      amountMinor: 2000,
      destination: IncomeDestination.SPECIAL_FUND,
    });
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'SPECIAL', name: `S ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });

    const result = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [
      { incomeId: income.id, fundId: fund.id },
    ]);
    expect(result[0]!.status).toBe('MIGRATED');
    const app = await observer.incomeApplication.findFirstOrThrow({ where: { incomeId: income.id } });
    expect(app.legacyDestination).toBe(IncomeDestination.SPECIAL_FUND);
    expect(await observer.fundTransaction.count({ where: { fundId: fund.id, direction: 'CREDIT' } })).toBe(1);
  }, 30000);

  it('M. wrong Fund type is rejected (RESERVE income + SPECIAL fund)', async () => {
    const ctx = await fixture('wrong-type');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, cat.id, {
      amountMinor: 2000,
      destination: IncomeDestination.RESERVE_FUND,
    });
    const fund = await observer.fund.create({
      data: { tenantId: ctx.tenant.id, scopeType: 'TENANT', type: 'SPECIAL', name: `W ${Date.now()}`, createdByMembershipId: ctx.membership.id },
    });

    const result = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [
      { incomeId: income.id, fundId: fund.id },
    ]);
    expect(result[0]!.status).toBe('INVALID_FUND');
    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(0);
    expect(await observer.fundTransaction.count({ where: { fundId: fund.id } })).toBe(0);
  }, 30000);

  it('N. archived Fund is rejected', async () => {
    const ctx = await fixture('archived-fund');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, cat.id, {
      amountMinor: 2000,
      destination: IncomeDestination.RESERVE_FUND,
    });
    const fund = await observer.fund.create({
      data: {
        tenantId: ctx.tenant.id,
        scopeType: 'TENANT',
        type: 'RESERVE',
        name: `A ${Date.now()}`,
        createdByMembershipId: ctx.membership.id,
        status: FundStatus.ARCHIVED,
      },
    });

    const result = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [
      { incomeId: income.id, fundId: fund.id },
    ]);
    expect(result[0]!.status).toBe('INVALID_FUND');
  }, 30000);

  it('O. cross-tenant Fund is rejected', async () => {
    const ctxA = await fixture('iso-a');
    const ctxB = await fixture('iso-b');
    const cat = await incomeCategory(ctxA.tenant.id);
    const income = await legacyIncome(ctxA.tenant.id, ctxA.membership.id, cat.id, {
      amountMinor: 2000,
      destination: IncomeDestination.RESERVE_FUND,
    });
    const fundB = await observer.fund.create({
      data: { tenantId: ctxB.tenant.id, scopeType: 'TENANT', type: 'RESERVE', name: `X ${Date.now()}`, createdByMembershipId: ctxB.membership.id },
    });

    const result = await backfill.apply(ctxA.tenant.id, ctxA.membership.id, roles, [
      { incomeId: income.id, fundId: fundB.id },
    ]);
    expect(result[0]!.status).toBe('INVALID_FUND');
  }, 30000);

  it('P. retry same backfill does not duplicate applications nor FundTransaction', async () => {
    const ctx = await fixture('retry');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, cat.id, {
      amountMinor: 3000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
    });

    const first = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [{ incomeId: income.id }]);
    const second = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [{ incomeId: income.id }]);

    expect(first[0]!.status).toBe('MIGRATED');
    expect(second[0]!.status).toBe('ALREADY_MIGRATED');
    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(1);
  }, 30000);

  it('Q. concurrent duplicate backfill produces exactly one application', async () => {
    const ctx = await fixture('dup-backfill');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, cat.id, {
      amountMinor: 3000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
    });

    const [a, b] = await Promise.all([
      backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [{ incomeId: income.id }]),
      backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [{ incomeId: income.id }]),
    ]);

    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(1);
    expect(a[0]!.status === 'MIGRATED' || b[0]!.status === 'MIGRATED').toBe(true);
  }, 30000);

  it('R. backfill vs manual plan: only one wins', async () => {
    const ctx = await fixture('backfill-vs-manual');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, cat.id, {
      amountMinor: 3000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
    });

    // Manual plan gana primero.
    await apps.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
      applications: [{ destinationType: IncomeApplicationDestination.CARRY_FORWARD, amountMinor: 3000 }],
    });

    const result = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [{ incomeId: income.id }]);
    expect(result[0]!.status).toBe('ALREADY_HAS_PLAN');
    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(1);
    const app = await observer.incomeApplication.findFirstOrThrow({ where: { incomeId: income.id } });
    expect(app.destinationType).toBe(IncomeApplicationDestination.CARRY_FORWARD);
    expect(app.legacyDestination).toBeNull();
  }, 30000);

  it('S. lazy vs manual plan: manual plan is authoritative', async () => {
    const ctx = await fixture('lazy-vs-manual');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      buildingId: buildingA.id,
    });

    // Plan manual CARRY 10000 antes del draft.
    await apps.createPlan(ctx.tenant.id, income.id, ctx.membership.id, roles, {
      applications: [{ destinationType: IncomeApplicationDestination.CARRY_FORWARD, amountMinor: 10000 }],
    });

    const draft = await createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id);
    expect(draft.incomeOffsetAmountMinor).toBe(0); // CARRY no descuenta; sin fallback OFFSET
    const app = await observer.incomeApplication.findFirstOrThrow({ where: { incomeId: income.id } });
    expect(app.destinationType).toBe(IncomeApplicationDestination.CARRY_FORWARD);
  }, 30000);

  it('T. backfill vs void: no applications created on VOID income', async () => {
    const ctx = await fixture('backfill-vs-void');
    const cat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, cat.id, {
      amountMinor: 3000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
    });

    await incomes.voidIncome(ctx.tenant.id, income.id, ctx.membership.id, roles);

    const result = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [{ incomeId: income.id }]);
    expect(result[0]!.status).toBe('NOT_RECORDED');
    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(0);
  }, 30000);

  it('U. two buildings lazy-materializing the same shared income produce one application', async () => {
    const ctx = await fixture('shared-race');
    const buildingA = await building(ctx.tenant.id, 'A');
    const buildingB = await building(ctx.tenant.id, 'B');
    await units(ctx.tenant.id, buildingA.id);
    await units(ctx.tenant.id, buildingB.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    await validatedExpense(ctx.tenant.id, buildingB.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      scopeType: MovementScope.TENANT_SHARED,
    });
    await allocateIncome(ctx.tenant.id, income.id, [
      { buildingId: buildingA.id, amountMinor: 6000 },
      { buildingId: buildingB.id, amountMinor: 4000 },
    ]);

    const [draftA, draftB] = await Promise.all([
      createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id),
      createDraftFor(ctx.tenant.id, buildingB.id, ctx.membership.id),
    ]);

    // UNA sola aplicación para el shared.
    expect(await observer.incomeApplication.count({ where: { incomeId: income.id } })).toBe(1);
    expect(draftA.incomeOffsetAmountMinor).toBe(6000);
    expect(draftB.incomeOffsetAmountMinor).toBe(4000);
  }, 30000);

  it('V. legacy functional frozen FX: live rate change does not affect lazy liquidation', async () => {
    const ctx = await fixture('legacy-fx');
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
        source: 'fixture-fin04',
      },
    });
    const income = await legacyIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 10000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
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

    const draft1 = await createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id);
    expect(draft1.incomeOffsetAmountMinor).toBe(2500);
    await liquidations.cancelLiquidation(ctx.tenant.id, draft1.id, ctx.membership.id);

    // Mutar FX live → el draft debe ser idéntico (snapshot congelado).
    await observer.exchangeRate.update({ where: { id: fx.id }, data: { rate: '0.50' } });
    const draft2 = await createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id);
    expect(draft2.incomeOffsetAmountMinor).toBe(2500);
  }, 30000);

  it('W. published Liquidation snapshot is unchanged by preview/backfill attempts', async () => {
    const ctx = await fixture('no-mutation');
    const buildingA = await building(ctx.tenant.id, 'A');
    await units(ctx.tenant.id, buildingA.id);
    const expCat = await expenseCategory(ctx.tenant.id);
    await validatedExpense(ctx.tenant.id, buildingA.id, expCat.id, 10000);
    const incCat = await incomeCategory(ctx.tenant.id);

    // Publicar liquidation A ANTES de que exista el legacy income.
    const draft = await createDraftFor(ctx.tenant.id, buildingA.id, ctx.membership.id);
    const reviewed = await liquidations.reviewLiquidation(ctx.tenant.id, draft.id, ctx.membership.id);
    await liquidations.publishLiquidation(ctx.tenant.id, reviewed.id, ctx.membership.id, { dueDate: '2026-09-10' });

    const before = await observer.liquidation.findUniqueOrThrow({ where: { id: draft.id } });
    const snapshotBefore = JSON.stringify(before.publicationSnapshot);
    const totalBefore = before.totalAmountMinor;
    const chargesBefore = await observer.charge.count({ where: { liquidationId: draft.id } });

    // El legacy aparece después → backfill debe bloquearse por conflicto.
    const legacy = await legacyIncome(ctx.tenant.id, ctx.membership.id, incCat.id, {
      amountMinor: 3000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      buildingId: buildingA.id,
    });
    await backfill.preview(ctx.tenant.id, ctx.membership.id, roles, {});
    const applyResult = await backfill.apply(ctx.tenant.id, ctx.membership.id, roles, [{ incomeId: legacy.id }]);
    expect(applyResult[0]!.status).toBe('LIQUIDATION_CONFLICT');

    // Nada mutó: snapshot, total, charges intactos.
    const after = await observer.liquidation.findUniqueOrThrow({ where: { id: draft.id } });
    expect(JSON.stringify(after.publicationSnapshot)).toBe(snapshotBefore);
    expect(after.totalAmountMinor).toBe(totalBefore);
    expect(await observer.charge.count({ where: { liquidationId: draft.id } })).toBe(chargesBefore);
    expect(await observer.incomeApplication.count({ where: { incomeId: legacy.id } })).toBe(0);
  }, 30000);

  it('X. tenant isolation: preview and apply are tenant-scoped', async () => {
    const ctxA = await fixture('iso-preview-a');
    const ctxB = await fixture('iso-preview-b');
    const catB = await incomeCategory(ctxB.tenant.id);
    const incomeB = await legacyIncome(ctxB.tenant.id, ctxB.membership.id, catB.id, {
      amountMinor: 3000,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
    });

    const previewA = await backfill.preview(ctxA.tenant.id, ctxA.membership.id, roles, {});
    expect(previewA).toHaveLength(0);

    const applyB = await backfill.apply(ctxB.tenant.id, ctxB.membership.id, roles, [{ incomeId: incomeB.id }]);
    expect(applyB[0]!.status).toBe('MIGRATED');
    expect(await observer.incomeApplication.count({ where: { tenantId: ctxA.tenant.id } })).toBe(0);
  }, 30000);

  it('Y. no fixture leftovers after the suite', async () => {
    const leftover = await observer.tenant.count({ where: { name: { startsWith: `${fixturePhase}-` } } });
    expect(leftover).toBe(0);
  }, 10000);
});
