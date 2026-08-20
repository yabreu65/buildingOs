import {
  CatalogScope,
  ExpenseStatus,
  FundScopeType,
  FundStatus,
  FundType,
  IncomeApplicationDestination,
  IncomeDestination,
  IncomePolicyVersionStatus,
  IncomeStatus,
  MovementType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { AuditService } from '../../src/audit/audit.service';
import { CurrencyConversionService } from '../../src/finanzas/currency-conversion.service';
import { FinanzasValidators } from '../../src/finanzas/finanzas.validators';
import { FundsService } from '../../src/finanzas/funds.service';
import { IncomeApplicationsService } from '../../src/finanzas/income-applications.service';
import { IncomePoliciesService } from '../../src/finanzas/income-policies.service';
import { IncomesService } from '../../src/finanzas/incomes.service';
import { MovementAllocationService } from '../../src/finanzas/movement-allocation.service';
import { allocateByLargestRemainder } from '../../src/finanzas/movement-allocation.service';
import { parseLiquidationPublicationSnapshot } from '../../src/finanzas/liquidation-publication-snapshot';
import { ResidentAccessService } from '../../src/resident-access/resident-access.service';

/**
 * Fixture finance determinística para tests E2E (FIN-07 Phase 2A).
 *
 * Slice NORMAL_V3: precondiciones seedeadas para probar en UNA liquidación la
 * ecuación V3 normal junto a múltiples provenance rows de income offset:
 *
 *   - Income BUILDING A1   1500 → OFFSET_EXPENSES 1500 (impacto A1 = 1500)
 *   - Income TENANT_SHARED 7000 → OFFSET_EXPENSES 7000, pesos A1:A2 = 3:2
 *     → buildingAmountMinor A1 4200 / A2 2800
 *   - Expense VALIDATED A1 6000
 *   - Liquidación V3 esperada para A1: gross 6000, adjustments 0, preIncome
 *     6000, offsets 1500 + 4200 = 5700, net 300 (Phase 2B la crea por UI/API).
 *
 * Los XML se crean SIEMPRE con el pipeline de producción (createIncome →
 * recordIncome → createPlan), de modo que el estado seedeado es exactamente el
 * que produciría la aplicación real (incluido el snapshot funcional IDENTITY).
 * El expense se crea como record VALIDATED determinístico (patrón del residuo
 * existente en la DB de test), porque el objetivo del fixture es el estado del
 * draft V3, no el flujo de carga de gastos.
 *
 * Slice FUNDS (precondición para Phase 2B / legacy backfill): se seedean dos
 * fondos TENANT ACTIVE (RESERVE y SPECIAL) a través de FundsService.createFund
 * (pipeline real con audit FUND_CREATE), sin transacciones en el ledger y sin
 * IncomeApplication referenciándolos. Cumplen las reglas del classifier legacy
 * (mismo tenant, ACTIVE, type correcto) sin auto-materializar nada.
 */

export const FIN07D_NORMAL_V3_PERIOD = '2026-06';
export const FIN07D_ZERO_NET_PERIOD = '2026-07';
export const FIN07D_ZERO_NET_EXPENSE_AMOUNT = 5000;
export const FIN07D_ZERO_NET_INCOME_AMOUNT = 5000;

const CATEGORY_INCOME_CODE = 'FIN07D_INCOME_COMMON';
const CATEGORY_INCOME_NAME = 'Ingreso Common FIN-07D';
const CATEGORY_EXPENSE_CODE = 'FIN07D_EXPENSE_FIXTURE';
const CATEGORY_EXPENSE_NAME = 'Gasto Fixture FIN-07D';
const CATEGORY_POLICY_INCOME_CODE = 'FIN07D_POLICY_INCOME';
const CATEGORY_POLICY_INCOME_NAME = 'Ingreso Policy FIN-07D';

export const FIN07D_POLICY_INCOME_AMOUNT = 10000;
export const FIN07D_POLICY_OFFSET_BPS = 6000;
export const FIN07D_POLICY_RESERVE_BPS = 2500;
export const FIN07D_POLICY_SPECIAL_BPS = 1500;

const EXPENSE_TAG = '[FIN07D:NORMAL_V3] Expense A1 6000';
const INCOME_BUILDING_TAG = '[FIN07D:NORMAL_V3] Income BUILDING A1 1500';
const INCOME_SHARED_TAG = '[FIN07D:NORMAL_V3] Income TENANT_SHARED 7000';
const ZERO_NET_EXPENSE_TAG = '[FIN07D:ZERO_NET] Expense A1 5000';
const ZERO_NET_INCOME_TAG = '[FIN07D:ZERO_NET] Income BUILDING A1 5000';

// ── Historical V1/V2 fixtures (FIN-07D Phase 2A HISTORICAL) ─────────────────
export const FIN07D_HISTORICAL_V1_PERIOD = '2026-03';
export const FIN07D_HISTORICAL_V2_PERIOD = '2026-02';
export const FIN07D_HISTORICAL_V1_TOTAL = 500_000; // minor ARS
export const FIN07D_HISTORICAL_V2_TOTAL = 420_000; // minor ARS

export const FIN07D_RESERVE_FUND_NAME = '[FIN07D:E2E] Fondo Reserva';
export const FIN07D_SPECIAL_FUND_NAME = '[FIN07D:E2E] Fondo Especial';
export const FIN07D_RESERVE_FUND_DESCRIPTION =
  'Fondo de reserva determinístico para E2E FIN-07D (precondición Phase 2B/legacy)';
export const FIN07D_SPECIAL_FUND_DESCRIPTION =
  'Fondo especial determinístico para E2E FIN-07D (precondición Phase 2B/legacy)';

export interface SeedFinanceFixtureInput {
  readonly prisma: PrismaClient;
  readonly tenantId: string;
  readonly adminMembershipId: string;
  readonly adminRoles: string[];
  readonly buildingA1Id: string;
  readonly buildingA2Id: string;
  readonly baseCurrency: string;
}

export interface SeedFinanceFixtureResult {
  readonly categoryIncomeId: string;
  readonly categoryExpenseId: string;
  readonly expenseId: string | null;
  readonly expenseCreated: boolean;
  readonly incomeBuildingId: string | null;
  readonly incomeBuildingCreated: boolean;
  readonly incomeSharedId: string | null;
  readonly incomeSharedCreated: boolean;
  readonly reserveFundId: string;
  readonly reserveFundCreated: boolean;
  readonly specialFundId: string;
  readonly specialFundCreated: boolean;
  readonly policyCategoryId: string;
  readonly policyCategoryCreated: boolean;
  readonly policyId: string;
  readonly policyCreated: boolean;
  readonly policyActiveVersionId: string;
  readonly activeVersionCount: number;
  readonly ruleOffsetId: string;
  readonly ruleReserveId: string;
  readonly ruleSpecialId: string;
  readonly totalBps: number;
  readonly zeroNetExpenseId: string;
  readonly zeroNetExpenseCreated: boolean;
  readonly zeroNetIncomeId: string;
  readonly zeroNetIncomeCreated: boolean;
  readonly zeroNetApplicationId: string;
  // Historical V1/V2 (FIN-07D Phase 2A HISTORICAL)
  readonly historicalV1LiquidationId: string;
  readonly historicalV1Created: boolean;
  readonly historicalV1ChargeCount: number;
  readonly historicalV2LiquidationId: string;
  readonly historicalV2Created: boolean;
  readonly historicalV2ChargeCount: number;
  // Legacy Income Backfill (FIN-07D Phase 2A LEGACY_BACKFILL)
  readonly legacyBackfillAutoOffsetIncomeId: string;
  readonly legacyBackfillAutoOffsetCreated: boolean;
  readonly legacyBackfillAlreadyPlanIncomeId: string;
  readonly legacyBackfillAlreadyPlanCreated: boolean;
  readonly legacyBackfillAlreadyPlanApplicationId: string;
  readonly legacyBackfillAlreadyPlanApplicationCreated: boolean;
  readonly legacyBackfillReserveFundIncomeId: string;
  readonly legacyBackfillReserveFundCreated: boolean;
  readonly legacyBackfillSpecialFundIncomeId: string;
  readonly legacyBackfillSpecialFundCreated: boolean;
  readonly legacyBackfillConflictIncomeId: string;
  readonly legacyBackfillConflictCreated: boolean;
  readonly legacyBackfillConflictLiquidationId: string;
  readonly legacyBackfillConflictLiquidationCreated: boolean;
}

export interface SeedFundInput {
  readonly prisma: PrismaClient;
  readonly tenantId: string;
  readonly adminMembershipId: string;
  readonly adminRoles: string[];
}

export interface SeedFundsResult {
  readonly reserveFundId: string;
  readonly reserveFundCreated: boolean;
  readonly specialFundId: string;
  readonly specialFundCreated: boolean;
}

/**
 * Asegura un fondo TENANT ACTIVE determinístico usando FundsService.createFund
 * (pipeline real + audit FUND_CREATE) o reutilizando el existente.
 *
 * Re-seed idempotente:
 * - Si existe con identity EXACTA (tenant + name + scope TENANT + type + ACTIVE)
 *   → reused, cero mutaciones.
 * - Si existe pero tiene un type/scope inmutable incompatible → STOP (no se
 *   reescribe semántica financiera).
 * - Nunca crea transacciones de ledger; balance inicial derivado 0.
 */
async function ensureTenantActiveFund(
  input: SeedFundInput,
  funds: FundsService,
  spec: {
    name: string;
    description: string;
    type: FundType;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await input.prisma.fund.findFirst({
    where: { tenantId: input.tenantId, name: spec.name },
  });

  if (existing) {
    if (
      existing.scopeType !== FundScopeType.TENANT ||
      existing.type !== spec.type ||
      existing.status !== FundStatus.ACTIVE ||
      existing.buildingId !== null
    ) {
      throw new Error(
        `Fixture fund "${spec.name}" exists with incompatible identity ` +
          `(scope=${existing.scopeType} type=${existing.type} status=${existing.status}): ` +
          'refusing to mutate financial semantics. Manual review required.',
      );
    }
    return { id: existing.id, created: false };
  }

  const created = await funds.createFund(
    input.tenantId,
    input.adminMembershipId,
    input.adminRoles,
    {
      scopeType: FundScopeType.TENANT,
      type: spec.type,
      name: spec.name,
      description: spec.description,
    },
  );

  return { id: created.id, created: true };
}

export async function ensureSeedFunds(
  input: SeedFundInput,
): Promise<SeedFundsResult> {
  const validators = new FinanzasValidators(
    input.prisma as never,
    new ResidentAccessService(input.prisma as never),
  );
  const auditService = new AuditService(input.prisma as never);
  const funds = new FundsService(input.prisma as never, auditService, validators);

  const reserve = await ensureTenantActiveFund(input, funds, {
    name: FIN07D_RESERVE_FUND_NAME,
    description: FIN07D_RESERVE_FUND_DESCRIPTION,
    type: FundType.RESERVE,
  });

  const special = await ensureTenantActiveFund(input, funds, {
    name: FIN07D_SPECIAL_FUND_NAME,
    description: FIN07D_SPECIAL_FUND_DESCRIPTION,
    type: FundType.SPECIAL,
  });

  // R2-3: Verify clean preconditions — no FundTransactions on deterministic funds.
  const [reserveTxCount, specialTxCount] = await Promise.all([
    input.prisma.fundTransaction.count({
      where: { tenantId: input.tenantId, fundId: reserve.id },
    }),
    input.prisma.fundTransaction.count({
      where: { tenantId: input.tenantId, fundId: special.id },
    }),
  ]);
  if (reserveTxCount !== 0) {
    throw new Error(
      `TEST-FIXTURE-DIRTY: RESERVE fund ${reserve.id} has ${reserveTxCount} transactions; expected 0`,
    );
  }
  if (specialTxCount !== 0) {
    throw new Error(
      `TEST-FIXTURE-DIRTY: SPECIAL fund ${special.id} has ${specialTxCount} transactions; expected 0`,
    );
  }

  return {
    reserveFundId: reserve.id,
    reserveFundCreated: reserve.created,
    specialFundId: special.id,
    specialFundCreated: special.created,
  };
}

async function ensureCategory(
  input: SeedFinanceFixtureInput,
  spec: { code: string; name: string; movementType: MovementType },
): Promise<string> {
  const existing = await input.prisma.expenseLedgerCategory.findFirst({
    where: { tenantId: input.tenantId, code: spec.code },
    select: { id: true },
  });

  if (existing) {
    await input.prisma.expenseLedgerCategory.update({
      where: { id: existing.id },
      data: {
        name: spec.name,
        movementType: spec.movementType,
        catalogScope: CatalogScope.BUILDING,
        sortOrder: 10,
        isActive: true,
      },
    });
    return existing.id;
  }

  const created = await input.prisma.expenseLedgerCategory.create({
    data: {
      tenantId: input.tenantId,
      code: spec.code,
      name: spec.name,
      movementType: spec.movementType,
      catalogScope: CatalogScope.BUILDING,
      sortOrder: 10,
      isActive: true,
    },
  });
  return created.id;
}

interface ValidatedExpenseSpec {
  period: string;
  amountMinor: number;
  descriptionTag: string;
  invoiceDate: Date;
  validatedAt: Date;
}

async function ensureValidatedExpense(
  input: SeedFinanceFixtureInput,
  categoryId: string,
  spec: ValidatedExpenseSpec,
): Promise<{ id: string; created: boolean }> {
  const invoiceDate = spec.invoiceDate;
  const validatedAt = spec.validatedAt;

  const existing = await input.prisma.expense.findFirst({
    where: {
      tenantId: input.tenantId,
      buildingId: input.buildingA1Id,
      period: spec.period,
      amountMinor: spec.amountMinor,
      description: spec.descriptionTag,
    },
    select: { id: true, status: true },
  });

  if (existing && existing.status === ExpenseStatus.VALIDATED) {
    const current = await input.prisma.expense.findFirstOrThrow({
      where: { id: existing.id },
      select: {
        functionalAmountMinor: true,
        functionalCurrencyCode: true,
        exchangeRateId: true,
        exchangeRateValue: true,
        exchangeRateDirection: true,
        exchangeRateEffectiveAt: true,
        conversionDate: true,
      },
    });

    const complete =
      current.functionalAmountMinor === spec.amountMinor &&
      current.functionalCurrencyCode === input.baseCurrency &&
      current.exchangeRateId === null &&
      current.exchangeRateDirection === 'IDENTITY' &&
      current.exchangeRateEffectiveAt === null &&
      (current.exchangeRateValue?.toString() ?? null) === '1' &&
      current.conversionDate?.toISOString() === invoiceDate.toISOString();

    if (!complete) {
      await input.prisma.expense.update({
        where: { id: existing.id },
        data: {
          functionalAmountMinor: spec.amountMinor,
          functionalCurrencyCode: input.baseCurrency,
          exchangeRateId: null,
          exchangeRateValue: '1',
          exchangeRateDirection: 'IDENTITY',
          exchangeRateEffectiveAt: null,
          conversionDate: invoiceDate,
        },
      });
    }
    return { id: existing.id, created: false };
  }

  if (existing) {
    throw new Error(
      `Fixture expense ${existing.id} exists with unexpected status ${existing.status}`,
    );
  }

  const created = await input.prisma.expense.create({
    data: {
      tenantId: input.tenantId,
      buildingId: input.buildingA1Id,
      period: spec.period,
      liquidationPeriod: spec.period,
      categoryId,
      scopeType: 'BUILDING',
      amountMinor: spec.amountMinor,
      currencyCode: input.baseCurrency,
      invoiceDate,
      postedAt: invoiceDate,
      description: spec.descriptionTag,
      status: ExpenseStatus.VALIDATED,
      createdByMembershipId: input.adminMembershipId,
      validatedByMembershipId: input.adminMembershipId,
      validatedAt,
      functionalAmountMinor: spec.amountMinor,
      functionalCurrencyCode: input.baseCurrency,
      exchangeRateValue: '1',
      exchangeRateDirection: 'IDENTITY',
      conversionDate: invoiceDate,
    },
    select: { id: true },
  });

  return { id: created.id, created: true };
}

const NORMAL_V3_EXPENSE_SPEC: ValidatedExpenseSpec = {
  period: FIN07D_NORMAL_V3_PERIOD,
  amountMinor: 6000,
  descriptionTag: EXPENSE_TAG,
  invoiceDate: new Date('2026-06-03T00:00:00.000Z'),
  validatedAt: new Date('2026-06-04T00:00:00.000Z'),
};

/**
 * Registra un Income con el pipeline real de producción y le publica el plan
 * OFFSET_EXPENSES canonical. Idempotente por tag de descripción: si el income
 * ya existe se asegura el estado final (RECORDED + plan OFFSET canonical) sin
 * recrear registros.
 *
 * R3 hardening:
 * - Pre-flight exact identity validation BEFORE any mutation (R3-1).
 * - DRAFT mutation only after identity confirmed (no mutation-before-validation).
 * - Canonical createPlan always (idempotent for same plan).
 * - Functional snapshot validated: IDENTITY exchange, 7 fields.
 * - Allocation exactness via production allocateByLargestRemainder (R3-2).
 */
async function ensureRecordedIncomeWithOffsetPlan(
  input: SeedFinanceFixtureInput,
  services: {
    incomes: IncomesService;
    applications: IncomeApplicationsService;
  },
  spec: {
    descriptionTag: string;
    amountMinor: number;
    period: string;
    receivedDate: string;
    buildingId: string | null;
    scopeType: 'BUILDING' | 'TENANT_SHARED';
    allocations?: Array<{ buildingId: string; percentage: number }>;
  },
  categoryId: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await input.prisma.income.findFirst({
    where: {
      tenantId: input.tenantId,
      period: spec.period,
      buildingId: spec.buildingId,
      scopeType: spec.scopeType,
      amountMinor: spec.amountMinor,
      description: spec.descriptionTag,
    },
    select: {
      id: true,
      status: true,
      tenantId: true,
      period: true,
      buildingId: true,
      scopeType: true,
      amountMinor: true,
      currencyCode: true,
      categoryId: true,
      receivedDate: true,
      description: true,
      destination: true,
    },
  });

  if (existing) {
    // R3-1: Pre-flight EXACT identity validation BEFORE any mutation.
    const expectedReceivedDate = new Date(spec.receivedDate);
    if (
      existing.tenantId !== input.tenantId ||
      existing.period !== spec.period ||
      existing.buildingId !== spec.buildingId ||
      existing.scopeType !== spec.scopeType ||
      existing.amountMinor !== spec.amountMinor ||
      existing.currencyCode !== input.baseCurrency ||
      existing.categoryId !== categoryId ||
      existing.description !== spec.descriptionTag ||
      existing.destination !== IncomeDestination.APPLY_TO_EXPENSES ||
      existing.receivedDate.toISOString() !== expectedReceivedDate.toISOString()
    ) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Income ${existing.id} exists with unexpected identity ` +
          `(tenantId=${existing.tenantId} period=${existing.period} buildingId=${existing.buildingId} ` +
          `scopeType=${existing.scopeType} amountMinor=${existing.amountMinor} currencyCode=${existing.currencyCode} ` +
          `categoryId=${existing.categoryId} destination=${existing.destination})`,
      );
    }

    // R3-1: DRAFT mutation only AFTER identity confirmed.
    if (existing.status === IncomeStatus.DRAFT) {
      await services.incomes.recordIncome(
        input.tenantId,
        existing.id,
        input.adminMembershipId,
        input.adminRoles,
      );
    } else if (existing.status !== IncomeStatus.RECORDED) {
      throw new Error(
        `Fixture income ${existing.id} has unexpected status ${existing.status}`,
      );
    }

    // Canonical createPlan even on reuse (idempotent for same plan).
    // Throws ConflictException if a different plan exists.
    await services.applications.createPlan(
      input.tenantId,
      existing.id,
      input.adminMembershipId,
      input.adminRoles,
      {
        applications: [
          {
            destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
            amountMinor: spec.amountMinor,
          },
        ],
      },
    );

    // Reload and validate functional snapshot (immutable RECORDED state).
    const reloaded = await input.prisma.income.findFirstOrThrow({
      where: { id: existing.id },
      select: {
        status: true,
        functionalAmountMinor: true,
        functionalCurrencyCode: true,
        exchangeRateId: true,
        exchangeRateValue: true,
        exchangeRateDirection: true,
        exchangeRateEffectiveAt: true,
        conversionDate: true,
      },
    });

    if (reloaded.status !== IncomeStatus.RECORDED) {
      throw new Error(
        `Fixture income ${existing.id} not RECORDED after recordIncome: ${reloaded.status}`,
      );
    }

    if (
      reloaded.functionalAmountMinor !== spec.amountMinor ||
      reloaded.functionalCurrencyCode !== input.baseCurrency ||
      reloaded.exchangeRateId !== null ||
      reloaded.exchangeRateDirection !== 'IDENTITY' ||
      reloaded.exchangeRateEffectiveAt !== null ||
      (reloaded.exchangeRateValue?.toString() ?? null) !== '1' ||
      reloaded.conversionDate?.toISOString() !== expectedReceivedDate.toISOString()
    ) {
      throw new Error(
        `Fixture income ${existing.id} has unexpected functional snapshot`,
      );
    }

    // R3-2: Validate allocation exactness using production allocation helper.
    if (spec.scopeType === 'BUILDING') {
      const allocCount = await input.prisma.movementAllocation.count({
        where: { tenantId: input.tenantId, incomeId: existing.id },
      });
      if (allocCount !== 0) {
        throw new Error(
          `Fixture BUILDING income ${existing.id} has ${allocCount} allocations but expected 0`,
        );
      }
    } else if (spec.allocations) {
      const actualAllocs = await input.prisma.movementAllocation.findMany({
        where: { tenantId: input.tenantId, incomeId: existing.id },
        select: { buildingId: true, amountMinor: true, percentage: true, currencyCode: true },
        orderBy: { buildingId: 'asc' },
      });

      // R3-2: Use production allocateByLargestRemainder for expected amounts.
      const expectedAmounts = allocateByLargestRemainder(
        spec.amountMinor,
        spec.allocations.map((a) => ({
          buildingId: a.buildingId,
          percentage: a.percentage,
        })),
      );
      const expectedAllocs = spec.allocations
        .map((a, i) => ({
          buildingId: a.buildingId,
          amountMinor: expectedAmounts[i]!,
          percentage: a.percentage,
          currencyCode: input.baseCurrency,
        }))
        .sort((a, b) => a.buildingId.localeCompare(b.buildingId));

      if (actualAllocs.length !== expectedAllocs.length) {
        throw new Error(
          `Fixture TENANT_SHARED income ${existing.id} has ${actualAllocs.length} allocations but expected ${expectedAllocs.length}`,
        );
      }
      for (let i = 0; i < expectedAllocs.length; i++) {
        if (
          actualAllocs[i]!.buildingId !== expectedAllocs[i]!.buildingId ||
          actualAllocs[i]!.amountMinor !== expectedAllocs[i]!.amountMinor ||
          actualAllocs[i]!.percentage !== expectedAllocs[i]!.percentage ||
          actualAllocs[i]!.currencyCode !== expectedAllocs[i]!.currencyCode
        ) {
          throw new Error(
            `Fixture TENANT_SHARED income ${existing.id} allocation mismatch at index ${i}: ` +
              `expected buildingId=${expectedAllocs[i]!.buildingId} amountMinor=${expectedAllocs[i]!.amountMinor} ` +
              `percentage=${expectedAllocs[i]!.percentage} currencyCode=${expectedAllocs[i]!.currencyCode} ` +
              `got buildingId=${actualAllocs[i]!.buildingId} amountMinor=${actualAllocs[i]!.amountMinor} ` +
              `percentage=${actualAllocs[i]!.percentage} currencyCode=${actualAllocs[i]!.currencyCode}`,
          );
        }
      }
    }

    return { id: existing.id, created: false };
  }

  const created = await services.incomes.createIncome(
    input.tenantId,
    input.adminMembershipId,
    input.adminRoles,
    {
      buildingId: spec.buildingId ?? undefined,
      period: spec.period,
      categoryId,
      amountMinor: spec.amountMinor,
      currencyCode: input.baseCurrency,
      receivedDate: spec.receivedDate,
      description: spec.descriptionTag,
      scopeType: spec.scopeType,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      ...(spec.allocations ? { allocations: spec.allocations } : {}),
    },
  );

  await services.incomes.recordIncome(
    input.tenantId,
    created.id,
    input.adminMembershipId,
    input.adminRoles,
  );
  await services.applications.createPlan(
    input.tenantId,
    created.id,
    input.adminMembershipId,
    input.adminRoles,
    {
      applications: [
        {
          destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
          amountMinor: spec.amountMinor,
        },
      ],
    },
  );

  // Validate functional snapshot on newly created income.
  const newlyCreated = await input.prisma.income.findFirstOrThrow({
    where: { id: created.id },
    select: {
      functionalAmountMinor: true,
      functionalCurrencyCode: true,
      exchangeRateId: true,
      exchangeRateDirection: true,
      exchangeRateEffectiveAt: true,
      exchangeRateValue: true,
      conversionDate: true,
    },
  });
  const expectedReceivedDate = new Date(spec.receivedDate);
  if (
    newlyCreated.functionalAmountMinor !== spec.amountMinor ||
    newlyCreated.functionalCurrencyCode !== input.baseCurrency ||
    newlyCreated.exchangeRateId !== null ||
    newlyCreated.exchangeRateDirection !== 'IDENTITY' ||
    newlyCreated.exchangeRateEffectiveAt !== null ||
    (newlyCreated.exchangeRateValue?.toString() ?? null) !== '1' ||
    newlyCreated.conversionDate?.toISOString() !== expectedReceivedDate.toISOString()
  ) {
    throw new Error(
      `Fixture income ${created.id} functional snapshot invalid after creation`,
    );
  }

  // R3-2: Validate allocation exactness on newly created income.
  if (spec.scopeType === 'BUILDING') {
    const allocCount = await input.prisma.movementAllocation.count({
      where: { tenantId: input.tenantId, incomeId: created.id },
    });
    if (allocCount !== 0) {
      throw new Error(
        `Fixture BUILDING income ${created.id} has ${allocCount} allocations but expected 0`,
      );
    }
  } else if (spec.allocations) {
    const actualAllocs = await input.prisma.movementAllocation.findMany({
      where: { tenantId: input.tenantId, incomeId: created.id },
      select: { buildingId: true, amountMinor: true, percentage: true, currencyCode: true },
      orderBy: { buildingId: 'asc' },
    });

    // R3-2: Use production allocateByLargestRemainder for expected amounts.
    const expectedAmounts = allocateByLargestRemainder(
      spec.amountMinor,
      spec.allocations.map((a) => ({
        buildingId: a.buildingId,
        percentage: a.percentage,
      })),
    );
    const expectedAllocs = spec.allocations
      .map((a, i) => ({
        buildingId: a.buildingId,
        amountMinor: expectedAmounts[i]!,
        percentage: a.percentage,
        currencyCode: input.baseCurrency,
      }))
      .sort((a, b) => a.buildingId.localeCompare(b.buildingId));

    if (actualAllocs.length !== expectedAllocs.length) {
      throw new Error(
        `Fixture TENANT_SHARED income ${created.id} has ${actualAllocs.length} allocations but expected ${expectedAllocs.length}`,
      );
    }
    for (let i = 0; i < expectedAllocs.length; i++) {
      if (
        actualAllocs[i]!.buildingId !== expectedAllocs[i]!.buildingId ||
        actualAllocs[i]!.amountMinor !== expectedAllocs[i]!.amountMinor ||
        actualAllocs[i]!.percentage !== expectedAllocs[i]!.percentage ||
        actualAllocs[i]!.currencyCode !== expectedAllocs[i]!.currencyCode
      ) {
        throw new Error(
          `Fixture TENANT_SHARED income ${created.id} allocation mismatch at index ${i}`,
        );
      }
    }
  }

  return { id: created.id, created: true };
}

export interface SeedPolicyResult {
  readonly policyCategoryId: string;
  readonly policyCategoryCreated: boolean;
  readonly policyId: string;
  readonly policyCreated: boolean;
  readonly policyActiveVersionId: string;
  readonly activeVersionCount: number;
  readonly ruleOffsetId: string;
  readonly ruleReserveId: string;
  readonly ruleSpecialId: string;
  readonly totalBps: number;
}

interface PolicyRuleSpec {
  destinationType: IncomeApplicationDestination;
  fundId: string | null;
  percentageBasisPoints: number;
}

const POLICY_RULES_SPEC = (input: {
  reserveFundId: string;
  specialFundId: string;
}): PolicyRuleSpec[] => [
  {
    destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
    fundId: null,
    percentageBasisPoints: FIN07D_POLICY_OFFSET_BPS,
  },
  {
    destinationType: IncomeApplicationDestination.FUND,
    fundId: input.reserveFundId,
    percentageBasisPoints: FIN07D_POLICY_RESERVE_BPS,
  },
  {
    destinationType: IncomeApplicationDestination.FUND,
    fundId: input.specialFundId,
    percentageBasisPoints: FIN07D_POLICY_SPECIAL_BPS,
  },
];

function rulesMatch(actual: readonly { destinationType: string; fundId: string | null; percentageBasisPoints: number }[], expected: readonly PolicyRuleSpec[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  const normalize = (rules: readonly { destinationType: string; fundId: string | null; percentageBasisPoints: number }[]) =>
    [...rules]
      .map((rule) => ({
        destinationType: rule.destinationType,
        fundId: rule.fundId,
        percentageBasisPoints: rule.percentageBasisPoints,
      }))
      .sort((a, b) =>
        a.destinationType === b.destinationType
          ? a.percentageBasisPoints - b.percentageBasisPoints
          : a.destinationType.localeCompare(b.destinationType),
      );
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}

/**
 * Asegura la categoría income dedicada a la política (determinística, sin
 * colisionar con la categoría NORMAL_V3) mediante ensureCategory.
 */
async function ensurePolicyCategory(input: SeedFinanceFixtureInput): Promise<{ id: string; created: boolean }> {
  const existing = await input.prisma.expenseLedgerCategory.findFirst({
    where: { tenantId: input.tenantId, code: CATEGORY_POLICY_INCOME_CODE },
    select: { id: true },
  });
  const id = await ensureCategory(input, {
    code: CATEGORY_POLICY_INCOME_CODE,
    name: CATEGORY_POLICY_INCOME_NAME,
    movementType: MovementType.INCOME,
  });
  return { id, created: !existing };
}

/**
 * Asegura la IncomePolicy determinística con UNA versión ACTIVE. Usa el pipeline
 * de producción (IncomePoliciesService.createPolicy) cuando no existe. Si ya
 * existe, verifica estado exacto (1 versión ACTIVE, reglas 6000/2500/1500 bp
 * con los funds RESERVE/SPECIAL) y reutiliza; si la versión inmutable difiere,
 * lanza (STOP, no se reescribe historia financiera).
 */
export async function ensureSeedPolicy(
  input: SeedFinanceFixtureInput,
  funds: { reserveFundId: string; specialFundId: string },
): Promise<SeedPolicyResult> {
  const policyCategory = await ensurePolicyCategory(input);

  const validators = new FinanzasValidators(
    input.prisma as never,
    new ResidentAccessService(input.prisma as never),
  );
  const auditService = new AuditService(input.prisma as never);
  const policies = new IncomePoliciesService(input.prisma as never, auditService, validators);

  const existing = await input.prisma.incomePolicy.findUnique({
    where: {
      tenantId_categoryId: {
        tenantId: input.tenantId,
        categoryId: policyCategory.id,
      },
    },
    include: {
      versions: {
        include: { rules: true },
        orderBy: { version: 'desc' },
      },
    },
  });

  const expectedRules = POLICY_RULES_SPEC(funds);

  if (existing) {
    const activeVersions = existing.versions.filter(
      (version) => version.status === IncomePolicyVersionStatus.ACTIVE,
    );
    if (activeVersions.length !== 1) {
      throw new Error(
        `Fixture income policy ${existing.id} has ${activeVersions.length} ACTIVE versions; ` +
          'exactly 1 required. Manual review required.',
      );
    }
    const active = activeVersions[0]!;
    const fresh = await input.prisma.incomePolicyVersion.findUnique({
      where: { id: active.id },
      include: { rules: true },
    });
    if (!fresh) {
      throw new Error(`Fixture income policy version ${active.id} not found`);
    }
    if (fresh.version !== 1) {
      throw new Error(
        `Fixture income policy ${existing.id} active version is v${fresh.version}, ` +
          'expected v1; refusing to publish a replacement version without PM approval.',
      );
    }
    if (!rulesMatch(fresh.rules, expectedRules)) {
      throw new Error(
        `Fixture income policy ${existing.id} has immutable active version v1 with ` +
          'rules that differ from the expected fixture; refusing to rewrite financial policy history.',
      );
    }

    const offset = fresh.rules.find(
      (rule) => rule.destinationType === IncomeApplicationDestination.OFFSET_EXPENSES,
    );
    const reserve = fresh.rules.find(
      (rule) =>
        rule.destinationType === IncomeApplicationDestination.FUND &&
        rule.fundId === funds.reserveFundId,
    );
    const special = fresh.rules.find(
      (rule) =>
        rule.destinationType === IncomeApplicationDestination.FUND &&
        rule.fundId === funds.specialFundId,
    );
    const totalBps = fresh.rules.reduce((sum, rule) => sum + rule.percentageBasisPoints, 0);

    return {
      policyCategoryId: policyCategory.id,
      policyCategoryCreated: policyCategory.created,
      policyId: existing.id,
      policyCreated: false,
      policyActiveVersionId: fresh.id,
      activeVersionCount: activeVersions.length,
      ruleOffsetId: offset!.id,
      ruleReserveId: reserve!.id,
      ruleSpecialId: special!.id,
      totalBps,
    };
  }

  const created = await policies.createPolicy(
    input.tenantId,
    input.adminMembershipId,
    input.adminRoles,
    {
      categoryId: policyCategory.id,
      rules: expectedRules.map((rule) => ({
        destinationType: rule.destinationType,
        ...(rule.fundId !== null ? { fundId: rule.fundId } : {}),
        percentageBasisPoints: rule.percentageBasisPoints,
      })),
    },
  );
  const active = created.currentVersion!;
  const offset = active.rules.find(
    (rule) => rule.destinationType === IncomeApplicationDestination.OFFSET_EXPENSES,
  );
  const reserve = active.rules.find(
    (rule) => rule.destinationType === IncomeApplicationDestination.FUND && rule.fundId === funds.reserveFundId,
  );
  const special = active.rules.find(
    (rule) => rule.destinationType === IncomeApplicationDestination.FUND && rule.fundId === funds.specialFundId,
  );
  const totalBps = active.rules.reduce((sum, rule) => sum + rule.percentageBasisPoints, 0);

  return {
    policyCategoryId: policyCategory.id,
    policyCategoryCreated: policyCategory.created,
    policyId: created.id,
    policyCreated: true,
    policyActiveVersionId: active.id,
    activeVersionCount: 1,
    ruleOffsetId: offset!.id,
    ruleReserveId: reserve!.id,
    ruleSpecialId: special!.id,
    totalBps,
  };
}

// ── Historical V1/V2 fixture ────────────────────────────────────────────────

export interface HistoricalV1V2Result {
  readonly v1LiquidationId: string;
  readonly v1Created: boolean;
  readonly v1ChargeCount: number;
  readonly v2LiquidationId: string;
  readonly v2Created: boolean;
  readonly v2ChargeCount: number;
}

function deterministicChargeAmount(total: number, unitCount: number, index: number): number {
  const base = Math.floor(total / unitCount);
  if (index < unitCount - 1) return base;
  return total - base * (unitCount - 1);
}

function buildV1PublicationSnapshot(args: {
  liquidationId: string;
  tenantId: string;
  buildingId: string;
  period: string;
  baseCurrency: string;
  totalAmountMinor: number;
  expenseSnapshot: unknown;
  allocations: Array<{ unitId: string; unitCode: string; unitLabel: string | null; amountMinor: number }>;
  dueDate: Date;
  publishedAt: Date;
}): Record<string, unknown> {
  return {
    version: 1,
    liquidationId: args.liquidationId,
    tenantId: args.tenantId,
    buildingId: args.buildingId,
    period: args.period,
    baseCurrency: args.baseCurrency,
    totalAmountMinor: args.totalAmountMinor,
    totalsByCurrency: { [args.baseCurrency]: args.totalAmountMinor },
    expenses: args.expenseSnapshot,
    allocations: args.allocations,
    dueDate: args.dueDate.toISOString(),
    publishedAt: args.publishedAt.toISOString(),
  };
}

function buildV2FunctionalPublicationSnapshot(args: {
  liquidationId: string;
  tenantId: string;
  buildingId: string;
  period: string;
  baseCurrency: string;
  totalAmountMinor: number;
  expenseSnapshot: unknown;
  allocations: Array<{ unitId: string; unitCode: string; unitLabel: string | null; amountMinor: number }>;
  dueDate: Date;
  publishedAt: Date;
}): Record<string, unknown> {
  return {
    version: 2,
    valuationMode: 'FUNCTIONAL',
    liquidationId: args.liquidationId,
    tenantId: args.tenantId,
    buildingId: args.buildingId,
    period: args.period,
    baseCurrency: args.baseCurrency,
    totalAmountMinor: args.totalAmountMinor,
    totalsByCurrency: { [args.baseCurrency]: args.totalAmountMinor },
    expenses: args.expenseSnapshot,
    allocations: args.allocations,
    dueDate: args.dueDate.toISOString(),
    publishedAt: args.publishedAt.toISOString(),
  };
}

export async function ensureHistoricalV1V2Liquidations(input: {
  readonly prisma: PrismaClient;
  readonly tenantId: string;
  readonly adminMembershipId: string;
  readonly buildingA1Id: string;
  readonly baseCurrency: string;
}): Promise<HistoricalV1V2Result> {
  const { prisma, tenantId, adminMembershipId, buildingA1Id, baseCurrency } = input;

  // Query deterministic units for building A1
  const units = await prisma.unit.findMany({
    where: { tenantId, buildingId: buildingA1Id },
    orderBy: { code: 'asc' },
    select: { id: true, code: true },
  });

  if (units.length === 0) {
    throw new Error(`No units found for building ${buildingA1Id} in tenant ${tenantId}`);
  }

  // ── V1 (period 2026-03) ──────────────────────────────────────────────────
  const v1Period = FIN07D_HISTORICAL_V1_PERIOD;
  const v1Total = FIN07D_HISTORICAL_V1_TOTAL;
  const v1ExpenseSnapshot = [{
    expenseId: 'seed-historical-v1-expense',
    categoryName: 'Expensas Comunes',
    vendorName: null,
    amountMinor: v1Total,
    currencyCode: baseCurrency,
    invoiceDate: `${v1Period}-01`,
    description: `[FIN07D:HISTORICAL_V1] Expense ${v1Period}`,
    type: 'EXPENSE',
  }];
  const v1DueDate = new Date(`${v1Period}-10T00:00:00.000Z`);
  const v1PublishedAt = new Date(`${v1Period}-12T00:00:00.000Z`);

  const existingV1 = await prisma.liquidation.findFirst({
    where: { tenantId, buildingId: buildingA1Id, period: v1Period },
    select: {
      id: true, status: true, totalAmountMinor: true, baseCurrency: true,
      publicationSnapshot: true, grossExpenseAmountMinor: true, adjustmentAmountMinor: true,
      preIncomeAmountMinor: true, incomeOffsetAmountMinor: true, netDistributableAmountMinor: true,
      incomeOffsetSnapshot: true, incomeOffsetsByCurrency: true, valuationMode: true,
    },
  });

  let v1LiquidationId: string;
  let v1Created: boolean;
  let v1ChargeCount: number;

  if (existingV1) {
    // Validate immutable historical state
    if (existingV1.totalAmountMinor !== v1Total) {
      throw new Error(`Historical V1 liquidation ${existingV1.id} has totalAmountMinor ${existingV1.totalAmountMinor} but expected ${v1Total}`);
    }
    if (existingV1.status !== 'PUBLISHED') {
      throw new Error(`Historical V1 liquidation ${existingV1.id} has status ${existingV1.status} but expected PUBLISHED`);
    }
    if (existingV1.baseCurrency !== baseCurrency) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V1 liquidation ${existingV1.id} has baseCurrency ${existingV1.baseCurrency}, expected ${baseCurrency}`,
      );
    }
    // Validate FIN-06 fields are all null (V1 legacy)
    if (existingV1.grossExpenseAmountMinor !== null || existingV1.adjustmentAmountMinor !== null ||
        existingV1.preIncomeAmountMinor !== null || existingV1.incomeOffsetAmountMinor !== null ||
        existingV1.netDistributableAmountMinor !== null) {
      throw new Error(`Historical V1 liquidation ${existingV1.id} has non-null FIN-06 fields`);
    }
    if (existingV1.incomeOffsetSnapshot !== null || existingV1.incomeOffsetsByCurrency !== null) {
      throw new Error(`Historical V1 liquidation ${existingV1.id} has non-null income offset snapshots`);
    }
    if (existingV1.valuationMode !== null) {
      throw new Error(`Historical V1 liquidation ${existingV1.id} has non-null valuationMode`);
    }

    // R2-5: Validate raw publicationSnapshot version === 1.
    const rawSnapshot = existingV1.publicationSnapshot as Record<string, unknown> | null;
    if (!rawSnapshot || typeof rawSnapshot !== 'object') {
      throw new Error(`Historical V1 liquidation ${existingV1.id} has invalid publicationSnapshot`);
    }
    const v1Raw = rawSnapshot as Record<string, unknown>;
    if (v1Raw.version !== 1) {
      throw new Error(
        `Historical V1 liquidation ${existingV1.id} raw snapshot version is ${v1Raw.version}, expected 1`,
      );
    }
    if (v1Raw.valuationMode !== undefined) {
      throw new Error(
        `Historical V1 liquidation ${existingV1.id} raw snapshot has unexpected valuationMode`,
      );
    }

    // R3-4: Validate baseCurrency present in raw snapshot.
    if (v1Raw.baseCurrency !== baseCurrency) {
      throw new Error(
        `Historical V1 liquidation ${existingV1.id} raw snapshot baseCurrency is ${v1Raw.baseCurrency}, expected ${baseCurrency}`,
      );
    }

    // R2-5: Parse and validate snapshot version.
    const parsedV1 = parseLiquidationPublicationSnapshot(existingV1.publicationSnapshot);
    if (!parsedV1) {
      throw new Error(`Historical V1 liquidation ${existingV1.id} parseLiquidationPublicationSnapshot returned null`);
    }
    if (parsedV1.version !== 1) {
      throw new Error(
        `Historical V1 liquidation ${existingV1.id} parsed version is ${parsedV1.version}, expected 1`,
      );
    }
    if (parsedV1.liquidationId !== existingV1.id) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V1 parsed snapshot liquidationId is ${parsedV1.liquidationId}, expected ${existingV1.id}`,
      );
    }
    if (parsedV1.tenantId !== tenantId) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V1 parsed snapshot tenantId is ${parsedV1.tenantId}, expected ${tenantId}`,
      );
    }
    if (parsedV1.buildingId !== buildingA1Id) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V1 parsed snapshot buildingId is ${parsedV1.buildingId}, expected ${buildingA1Id}`,
      );
    }
    if (parsedV1.period !== v1Period) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V1 parsed snapshot period is ${parsedV1.period}, expected ${v1Period}`,
      );
    }
    // R3-4: Validate baseCurrency from parsed snapshot.
    if (parsedV1.baseCurrency !== baseCurrency) {
      throw new Error(
        `Historical V1 liquidation ${existingV1.id} parsed baseCurrency is ${parsedV1.baseCurrency}, expected ${baseCurrency}`,
      );
    }
    if (parsedV1.totalAmountMinor !== v1Total) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V1 parsed snapshot totalAmountMinor is ${parsedV1.totalAmountMinor}, expected ${v1Total}`,
      );
    }

    // R2-5: Validate relational offsets count = 0.
    const v1OffsetCount = await prisma.liquidationIncomeOffset.count({
      where: { tenantId, liquidationId: existingV1.id },
    });
    if (v1OffsetCount !== 0) {
      throw new Error(
        `Historical V1 liquidation ${existingV1.id} has ${v1OffsetCount} relational offsets; expected 0`,
      );
    }

    v1LiquidationId = existingV1.id;
    v1Created = false;

    // R3-3: Query ALL charges by liquidationId only (no tenantId/buildingId/period pre-filter).
    const v1Charges = await prisma.charge.findMany({
      where: { liquidationId: existingV1.id },
      select: { id: true, tenantId: true, buildingId: true, unitId: true, period: true, amount: true, currency: true, liquidationId: true },
    });
    v1ChargeCount = v1Charges.length;
    if (v1ChargeCount !== units.length) {
      throw new Error(`Historical V1 liquidation ${existingV1.id} has ${v1ChargeCount} charges but expected ${units.length}`);
    }

    // R2-5: Validate charge sum == liquidation total.
    const v1ChargeSum = v1Charges.reduce((sum, c) => sum + c.amount, 0);
    if (v1ChargeSum !== v1Total) {
      throw new Error(
        `Historical V1 liquidation ${existingV1.id} charge sum ${v1ChargeSum} != total ${v1Total}`,
      );
    }

    // R3-3: Exact charge set — every charge validated field-by-field against deterministic expectation.
    for (let i = 0; i < units.length; i++) {
      const unit = units[i]!;
      const expectedAmount = deterministicChargeAmount(v1Total, units.length, i);
      const charge = v1Charges.find((c) => c.unitId === unit.id);
      if (!charge) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V1 liquidation ${existingV1.id} missing charge for unit ${unit.id} (${unit.code})`,
        );
      }
      if (charge.tenantId !== tenantId) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V1 charge ${charge.id} tenantId is ${charge.tenantId}, expected ${tenantId}`,
        );
      }
      if (charge.buildingId !== buildingA1Id) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V1 charge ${charge.id} buildingId is ${charge.buildingId}, expected ${buildingA1Id}`,
        );
      }
      if (charge.period !== v1Period) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V1 charge ${charge.id} period is ${charge.period}, expected ${v1Period}`,
        );
      }
      if (charge.currency !== baseCurrency) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V1 charge ${charge.id} currency is ${charge.currency}, expected ${baseCurrency}`,
        );
      }
      if (charge.liquidationId !== existingV1.id) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V1 charge ${charge.id} liquidationId is ${charge.liquidationId}, expected ${existingV1.id}`,
        );
      }
      if (charge.amount !== expectedAmount) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V1 charge ${charge.id} for unit ${unit.id} (${unit.code}) amount is ${charge.amount}, expected ${expectedAmount}`,
        );
      }
    }

    // No unexpected unit IDs beyond what we expect.
    const v1UnexpectedUnits = v1Charges.filter(
      (c) => !units.some((u) => u.id === c.unitId),
    );
    if (v1UnexpectedUnits.length > 0) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V1 liquidation ${existingV1.id} has ${v1UnexpectedUnits.length} unexpected charges with unknown unitIds`,
      );
    }
  } else {
    // R2-6: Wrap entire V1 construction in one Prisma transaction for atomicity.
    const v1Result = await prisma.$transaction(async (tx) => {
      const v1Draft = await tx.liquidation.create({
        data: {
          tenantId, buildingId: buildingA1Id, period: v1Period,
          status: 'DRAFT', baseCurrency, totalAmountMinor: v1Total,
          totalsByCurrency: { [baseCurrency]: v1Total },
          expenseSnapshot: v1ExpenseSnapshot,
          unitCount: units.length,
          generatedByMembershipId: adminMembershipId,
          valuationMode: null,
          grossExpenseAmountMinor: null,
          adjustmentAmountMinor: null,
          preIncomeAmountMinor: null,
          incomeOffsetAmountMinor: null,
          netDistributableAmountMinor: null,
          incomeOffsetSnapshot: Prisma.DbNull,
          incomeOffsetsByCurrency: Prisma.DbNull,
        },
      });

      await tx.liquidation.update({
        where: { id: v1Draft.id },
        data: {
          status: 'REVIEWED',
          reviewedByMembershipId: adminMembershipId,
          reviewedAt: v1PublishedAt,
        },
      });

      const v1Allocations = units.map((unit, i) => ({
        unitId: unit.id,
        unitCode: unit.code,
        unitLabel: `Unidad ${unit.code}`,
        amountMinor: deterministicChargeAmount(v1Total, units.length, i),
      }));

      const v1Snapshot = buildV1PublicationSnapshot({
        liquidationId: v1Draft.id,
        tenantId, buildingId: buildingA1Id, period: v1Period, baseCurrency,
        totalAmountMinor: v1Total, expenseSnapshot: v1ExpenseSnapshot,
        allocations: v1Allocations,
        dueDate: v1DueDate, publishedAt: v1PublishedAt,
      });

      await tx.liquidation.update({
        where: { id: v1Draft.id },
        data: {
          status: 'PUBLISHED',
          publicationSnapshot: v1Snapshot as unknown as Prisma.InputJsonValue,
          publishedByMembershipId: adminMembershipId,
          publishedAt: v1PublishedAt,
        },
      });

      const chargeData = units.map((unit, index) => ({
        tenantId, buildingId: buildingA1Id, unitId: unit.id,
        period: v1Period, type: 'COMMON_EXPENSE' as const,
        concept: `[FIN07D:HISTORICAL_V1] Expensas ${v1Period} ${unit.code}`,
        amount: deterministicChargeAmount(v1Total, units.length, index),
        currency: baseCurrency, dueDate: v1DueDate,
        status: 'PENDING' as const,
        createdByMembershipId: adminMembershipId,
        liquidationId: v1Draft.id,
      }));

      await tx.charge.createMany({ data: chargeData });

      return { id: v1Draft.id, chargeCount: chargeData.length };
    });

    v1LiquidationId = v1Result.id;
    v1Created = true;
    v1ChargeCount = v1Result.chargeCount;
  }

  // ── V2 FUNCTIONAL (period 2026-02) ───────────────────────────────────────
  const v2Period = FIN07D_HISTORICAL_V2_PERIOD;
  const v2Total = FIN07D_HISTORICAL_V2_TOTAL;
  const v2ExpenseSnapshot = [{
    expenseId: 'seed-historical-v2-expense',
    categoryName: 'Expensas Comunes',
    vendorName: null,
    amountMinor: v2Total,
    currencyCode: baseCurrency,
    invoiceDate: `${v2Period}-01`,
    description: `[FIN07D:HISTORICAL_V2] Expense ${v2Period}`,
    type: 'EXPENSE',
    functionalAmountMinor: v2Total,
    functionalCurrencyCode: baseCurrency,
    exchangeRateId: null,
    exchangeRateValue: null,
    exchangeRateDirection: null,
    exchangeRateEffectiveAt: null,
    conversionDate: `${v2Period}-01`,
  }];
  const v2DueDate = new Date(`${v2Period}-10T00:00:00.000Z`);
  const v2PublishedAt = new Date(`${v2Period}-12T00:00:00.000Z`);

  const existingV2 = await prisma.liquidation.findFirst({
    where: { tenantId, buildingId: buildingA1Id, period: v2Period },
    select: {
      id: true, status: true, totalAmountMinor: true, baseCurrency: true,
      publicationSnapshot: true, grossExpenseAmountMinor: true, adjustmentAmountMinor: true,
      preIncomeAmountMinor: true, incomeOffsetAmountMinor: true, netDistributableAmountMinor: true,
      incomeOffsetSnapshot: true, incomeOffsetsByCurrency: true, valuationMode: true,
    },
  });

  let v2LiquidationId: string;
  let v2Created: boolean;
  let v2ChargeCount: number;

  if (existingV2) {
    // Validate immutable historical state
    if (existingV2.totalAmountMinor !== v2Total) {
      throw new Error(`Historical V2 liquidation ${existingV2.id} has totalAmountMinor ${existingV2.totalAmountMinor} but expected ${v2Total}`);
    }
    if (existingV2.status !== 'PUBLISHED') {
      throw new Error(`Historical V2 liquidation ${existingV2.id} has status ${existingV2.status} but expected PUBLISHED`);
    }
    if (existingV2.baseCurrency !== baseCurrency) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V2 liquidation ${existingV2.id} has baseCurrency ${existingV2.baseCurrency}, expected ${baseCurrency}`,
      );
    }
    if (existingV2.valuationMode !== 'FUNCTIONAL') {
      throw new Error(`Historical V2 liquidation ${existingV2.id} has valuationMode ${existingV2.valuationMode} but expected FUNCTIONAL`);
    }
    // Validate FIN-06 fields are all null (V2 historical with no offsets)
    if (existingV2.grossExpenseAmountMinor !== null || existingV2.adjustmentAmountMinor !== null ||
        existingV2.preIncomeAmountMinor !== null || existingV2.incomeOffsetAmountMinor !== null ||
        existingV2.netDistributableAmountMinor !== null) {
      throw new Error(`Historical V2 liquidation ${existingV2.id} has non-null FIN-06 fields`);
    }
    if (existingV2.incomeOffsetSnapshot !== null || existingV2.incomeOffsetsByCurrency !== null) {
      throw new Error(`Historical V2 liquidation ${existingV2.id} has non-null income offset snapshots`);
    }

    // R2-5: Validate raw publicationSnapshot version === 2, valuationMode === FUNCTIONAL.
    const rawSnapshot = existingV2.publicationSnapshot as Record<string, unknown> | null;
    if (!rawSnapshot || typeof rawSnapshot !== 'object') {
      throw new Error(`Historical V2 liquidation ${existingV2.id} has invalid publicationSnapshot`);
    }
    const v2Raw = rawSnapshot as Record<string, unknown>;
    if (v2Raw.version !== 2) {
      throw new Error(
        `Historical V2 liquidation ${existingV2.id} raw snapshot version is ${v2Raw.version}, expected 2`,
      );
    }
    if (v2Raw.valuationMode !== 'FUNCTIONAL') {
      throw new Error(
        `Historical V2 liquidation ${existingV2.id} raw snapshot valuationMode is ${v2Raw.valuationMode}, expected FUNCTIONAL`,
      );
    }

    // R3-4: Validate baseCurrency present in raw snapshot.
    if (v2Raw.baseCurrency !== baseCurrency) {
      throw new Error(
        `Historical V2 liquidation ${existingV2.id} raw snapshot baseCurrency is ${v2Raw.baseCurrency}, expected ${baseCurrency}`,
      );
    }

    // R2-5: Parse and validate snapshot version = 2, valuationMode = FUNCTIONAL.
    const parsedV2 = parseLiquidationPublicationSnapshot(existingV2.publicationSnapshot);
    if (!parsedV2) {
      throw new Error(`Historical V2 liquidation ${existingV2.id} parseLiquidationPublicationSnapshot returned null`);
    }
    if (parsedV2.version !== 2) {
      throw new Error(
        `Historical V2 liquidation ${existingV2.id} parsed version is ${parsedV2.version}, expected 2`,
      );
    }
    if (parsedV2.valuationMode !== 'FUNCTIONAL') {
      throw new Error(
        `Historical V2 liquidation ${existingV2.id} parsed valuationMode is ${parsedV2.valuationMode}, expected FUNCTIONAL`,
      );
    }
    if (parsedV2.liquidationId !== existingV2.id) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V2 parsed snapshot liquidationId is ${parsedV2.liquidationId}, expected ${existingV2.id}`,
      );
    }
    if (parsedV2.tenantId !== tenantId) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V2 parsed snapshot tenantId is ${parsedV2.tenantId}, expected ${tenantId}`,
      );
    }
    if (parsedV2.buildingId !== buildingA1Id) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V2 parsed snapshot buildingId is ${parsedV2.buildingId}, expected ${buildingA1Id}`,
      );
    }
    if (parsedV2.period !== v2Period) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V2 parsed snapshot period is ${parsedV2.period}, expected ${v2Period}`,
      );
    }
    // R3-4: Validate baseCurrency from parsed snapshot.
    if (parsedV2.baseCurrency !== baseCurrency) {
      throw new Error(
        `Historical V2 liquidation ${existingV2.id} parsed baseCurrency is ${parsedV2.baseCurrency}, expected ${baseCurrency}`,
      );
    }
    if (parsedV2.totalAmountMinor !== v2Total) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V2 parsed snapshot totalAmountMinor is ${parsedV2.totalAmountMinor}, expected ${v2Total}`,
      );
    }

    // R2-5: Validate relational offsets count = 0.
    const v2OffsetCount = await prisma.liquidationIncomeOffset.count({
      where: { tenantId, liquidationId: existingV2.id },
    });
    if (v2OffsetCount !== 0) {
      throw new Error(
        `Historical V2 liquidation ${existingV2.id} has ${v2OffsetCount} relational offsets; expected 0`,
      );
    }

    v2LiquidationId = existingV2.id;
    v2Created = false;

    // R3-3: Query ALL charges by liquidationId only (no tenantId/buildingId/period pre-filter).
    const v2Charges = await prisma.charge.findMany({
      where: { liquidationId: existingV2.id },
      select: { id: true, tenantId: true, buildingId: true, unitId: true, period: true, amount: true, currency: true, liquidationId: true },
    });
    v2ChargeCount = v2Charges.length;
    if (v2ChargeCount !== units.length) {
      throw new Error(`Historical V2 liquidation ${existingV2.id} has ${v2ChargeCount} charges but expected ${units.length}`);
    }

    // R2-5: Validate charge sum == liquidation total.
    const v2ChargeSum = v2Charges.reduce((sum, c) => sum + c.amount, 0);
    if (v2ChargeSum !== v2Total) {
      throw new Error(
        `Historical V2 liquidation ${existingV2.id} charge sum ${v2ChargeSum} != total ${v2Total}`,
      );
    }

    // R3-3: Exact charge set — every charge validated field-by-field against deterministic expectation.
    for (let i = 0; i < units.length; i++) {
      const unit = units[i]!;
      const expectedAmount = deterministicChargeAmount(v2Total, units.length, i);
      const charge = v2Charges.find((c) => c.unitId === unit.id);
      if (!charge) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V2 liquidation ${existingV2.id} missing charge for unit ${unit.id} (${unit.code})`,
        );
      }
      if (charge.tenantId !== tenantId) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V2 charge ${charge.id} tenantId is ${charge.tenantId}, expected ${tenantId}`,
        );
      }
      if (charge.buildingId !== buildingA1Id) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V2 charge ${charge.id} buildingId is ${charge.buildingId}, expected ${buildingA1Id}`,
        );
      }
      if (charge.period !== v2Period) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V2 charge ${charge.id} period is ${charge.period}, expected ${v2Period}`,
        );
      }
      if (charge.currency !== baseCurrency) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V2 charge ${charge.id} currency is ${charge.currency}, expected ${baseCurrency}`,
        );
      }
      if (charge.liquidationId !== existingV2.id) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V2 charge ${charge.id} liquidationId is ${charge.liquidationId}, expected ${existingV2.id}`,
        );
      }
      if (charge.amount !== expectedAmount) {
        throw new Error(
          `TEST-FIXTURE-DIRTY: Historical V2 charge ${charge.id} for unit ${unit.id} (${unit.code}) amount is ${charge.amount}, expected ${expectedAmount}`,
        );
      }
    }

    // No unexpected unit IDs beyond what we expect.
    const v2UnexpectedUnits = v2Charges.filter(
      (c) => !units.some((u) => u.id === c.unitId),
    );
    if (v2UnexpectedUnits.length > 0) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Historical V2 liquidation ${existingV2.id} has ${v2UnexpectedUnits.length} unexpected charges with unknown unitIds`,
      );
    }
  } else {
    // R2-6: Wrap entire V2 construction in one Prisma transaction for atomicity.
    const v2Result = await prisma.$transaction(async (tx) => {
      const v2Draft = await tx.liquidation.create({
        data: {
          tenantId, buildingId: buildingA1Id, period: v2Period,
          status: 'DRAFT', baseCurrency, totalAmountMinor: v2Total,
          totalsByCurrency: { [baseCurrency]: v2Total },
          expenseSnapshot: v2ExpenseSnapshot,
          unitCount: units.length,
          generatedByMembershipId: adminMembershipId,
          valuationMode: 'FUNCTIONAL',
          grossExpenseAmountMinor: null,
          adjustmentAmountMinor: null,
          preIncomeAmountMinor: null,
          incomeOffsetAmountMinor: null,
          netDistributableAmountMinor: null,
          incomeOffsetSnapshot: Prisma.DbNull,
          incomeOffsetsByCurrency: Prisma.DbNull,
        },
      });

      await tx.liquidation.update({
        where: { id: v2Draft.id },
        data: {
          status: 'REVIEWED',
          reviewedByMembershipId: adminMembershipId,
          reviewedAt: v2PublishedAt,
        },
      });

      const v2Allocations = units.map((unit, i) => ({
        unitId: unit.id,
        unitCode: unit.code,
        unitLabel: `Unidad ${unit.code}`,
        amountMinor: deterministicChargeAmount(v2Total, units.length, i),
      }));

      const v2Snapshot = buildV2FunctionalPublicationSnapshot({
        liquidationId: v2Draft.id,
        tenantId, buildingId: buildingA1Id, period: v2Period, baseCurrency,
        totalAmountMinor: v2Total, expenseSnapshot: v2ExpenseSnapshot,
        allocations: v2Allocations,
        dueDate: v2DueDate, publishedAt: v2PublishedAt,
      });

      await tx.liquidation.update({
        where: { id: v2Draft.id },
        data: {
          status: 'PUBLISHED',
          publicationSnapshot: v2Snapshot as unknown as Prisma.InputJsonValue,
          publishedByMembershipId: adminMembershipId,
          publishedAt: v2PublishedAt,
        },
      });

      const chargeData = units.map((unit, index) => ({
        tenantId, buildingId: buildingA1Id, unitId: unit.id,
        period: v2Period, type: 'COMMON_EXPENSE' as const,
        concept: `[FIN07D:HISTORICAL_V2] Expensas ${v2Period} ${unit.code}`,
        amount: deterministicChargeAmount(v2Total, units.length, index),
        currency: baseCurrency, dueDate: v2DueDate,
        status: 'PENDING' as const,
        createdByMembershipId: adminMembershipId,
        liquidationId: v2Draft.id,
      }));

      await tx.charge.createMany({ data: chargeData });

      return { id: v2Draft.id, chargeCount: chargeData.length };
    });

    v2LiquidationId = v2Result.id;
    v2Created = true;
    v2ChargeCount = v2Result.chargeCount;
  }

  return {
    v1LiquidationId,
    v1Created,
    v1ChargeCount,
    v2LiquidationId,
    v2Created,
    v2ChargeCount,
  };
}

// ── Legacy Income Backfill Fixtures (FIN-07D Phase 2A LEGACY_BACKFILL) ──────
// Pre-backfill state: 5 Income records determinísticos, cada uno en un período
// único, diseñados para clasificarse en cada categoría del classifier legacy.
// NO se crean IncomeApplications (excepto ALREADY_HAS_PLAN) ni FundTransactions.
// Períodos 2025-08..2025-12 (anteriores a V1/V2 para evitar conflictos).
//
// Fixture 1: AUTO_MAPPABLE_OFFSET — RECORDED, APPLY_TO_EXPENSES, sin apps, sin liquidación
// Fixture 2: ALREADY_HAS_PLAN     — RECORDED, con IncomeApplication preexistente
// Fixture 3: REQUIRES_RESERVE_FUND — RECORDED, RESERVE_FUND, sin apps
// Fixture 4: REQUIRES_SPECIAL_FUND — RECORDED, SPECIAL_FUND, sin apps
// Fixture 5: LIQUIDATION_CONFLICT  — RECORDED, APPLY_TO_EXPENSES, sin apps, con liquidación DRAFT

export const LEGACY_BACKFIX_AUTO_OFFSET_ID = 'seed-legacy-backfill-auto-offset-2025-10';
export const LEGACY_BACKFIX_ALREADY_PLAN_ID = 'seed-legacy-backfill-already-plan-2025-11';
export const LEGACY_BACKFIX_RESERVE_FUND_ID = 'seed-legacy-backfill-reserve-fund-2025-09';
export const LEGACY_BACKFIX_SPECIAL_FUND_ID = 'seed-legacy-backfill-special-fund-2025-08';
export const LEGACY_BACKFIX_CONFLICT_ID = 'seed-legacy-backfill-conflict-2025-12';
export const LEGACY_BACKFIX_CONFLICT_LIQUIDATION_ID = 'seed-legacy-backfill-conflict-liq-2025-12';

export const LEGACY_BACKFIX_AUTO_OFFSET_PERIOD = '2025-10';
export const LEGACY_BACKFIX_ALREADY_PLAN_PERIOD = '2025-11';
export const LEGACY_BACKFIX_RESERVE_FUND_PERIOD = '2025-09';
export const LEGACY_BACKFIX_SPECIAL_FUND_PERIOD = '2025-08';
export const LEGACY_BACKFIX_CONFLICT_PERIOD = '2025-12';

export interface LegacyBackfillFixturesResult {
  readonly autoOffsetIncomeId: string;
  readonly autoOffsetCreated: boolean;
  readonly alreadyPlanIncomeId: string;
  readonly alreadyPlanCreated: boolean;
  readonly alreadyPlanApplicationId: string;
  readonly alreadyPlanApplicationCreated: boolean;
  readonly reserveFundIncomeId: string;
  readonly reserveFundCreated: boolean;
  readonly specialFundIncomeId: string;
  readonly specialFundCreated: boolean;
  readonly conflictIncomeId: string;
  readonly conflictCreated: boolean;
  readonly conflictLiquidationId: string;
  readonly conflictLiquidationCreated: boolean;
}

/**
 * Asegura 5 Incomes legacy pre-backfill, cada uno en un período único,
 * clasificable en cada categoría del classifier.
 *
 * Re-seed idempotente:
 * - Si el income ya existe (mismo ID) → reused + exact-state validation.
 * - Si falta → create directo con status RECORDED (sin pipeline de servicios).
 * - Para ALREADY_HAS_PLAN: usa canonical IncomeApplicationsService.createPlan.
 * - Para AUTO/RESERVE/SPECIAL/CONFLICT: dirty guard (0 applications).
 * - Para LIQUIDATION_CONFLICT: valida estado exacto de la liquidación DRAFT.
 * - Nunca crea FundTransactions; balance = 0.
 */
export async function ensureLegacyIncomeBackfillFixtures(input: {
  readonly prisma: PrismaClient;
  readonly tenantId: string;
  readonly adminMembershipId: string;
  readonly adminRoles: string[];
  readonly buildingA1Id: string;
  readonly baseCurrency: string;
  readonly categoryIncomeId: string;
  readonly applications: IncomeApplicationsService;
}): Promise<LegacyBackfillFixturesResult> {
  const { prisma, tenantId, adminMembershipId, adminRoles, buildingA1Id, baseCurrency, categoryIncomeId, applications } = input;
  const now = new Date('2025-08-01T00:00:00.000Z');

  // ── Fixture 1: AUTO_MAPPABLE_OFFSET ──────────────────────────────────────
  // RECORDED, APPLY_TO_EXPENSES, no apps, no liquidation → classifier returns AUTO_MAPPABLE_OFFSET
  const existingAuto = await prisma.income.findUnique({
    where: { id: LEGACY_BACKFIX_AUTO_OFFSET_ID },
    select: {
      id: true, tenantId: true, buildingId: true, period: true, categoryId: true,
      scopeType: true, destination: true, amountMinor: true, currencyCode: true, status: true,
    },
  });
  let autoOffsetCreated = false;
  if (existingAuto) {
    // R2-4: Validate exact expected fixture identity.
    if (
      existingAuto.tenantId !== tenantId ||
      existingAuto.buildingId !== buildingA1Id ||
      existingAuto.period !== LEGACY_BACKFIX_AUTO_OFFSET_PERIOD ||
      existingAuto.categoryId !== categoryIncomeId ||
      existingAuto.scopeType !== 'BUILDING' ||
      existingAuto.destination !== 'APPLY_TO_EXPENSES' ||
      existingAuto.amountMinor !== 2000 ||
      existingAuto.currencyCode !== baseCurrency ||
      existingAuto.status !== 'RECORDED'
    ) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Legacy AUTO income ${LEGACY_BACKFIX_AUTO_OFFSET_ID} exists with unexpected identity`,
      );
    }
    // R2-4: Dirty guard — no applications expected.
    const autoAppCount = await prisma.incomeApplication.count({
      where: { tenantId, incomeId: LEGACY_BACKFIX_AUTO_OFFSET_ID },
    });
    if (autoAppCount !== 0) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Legacy AUTO income has ${autoAppCount} applications; expected 0`,
      );
    }
  } else {
    await prisma.income.create({
      data: {
        id: LEGACY_BACKFIX_AUTO_OFFSET_ID,
        tenantId,
        buildingId: buildingA1Id,
        period: LEGACY_BACKFIX_AUTO_OFFSET_PERIOD,
        categoryId: categoryIncomeId,
        scopeType: 'BUILDING',
        destination: 'APPLY_TO_EXPENSES',
        amountMinor: 2000,
        currencyCode: baseCurrency,
        receivedDate: new Date(`${LEGACY_BACKFIX_AUTO_OFFSET_PERIOD}-05T00:00:00.000Z`),
        description: '[FIN07D:LEGACY_BACKFILL] AUTO_MAPPABLE_OFFSET 2025-10',
        status: 'RECORDED',
        createdByMembershipId: adminMembershipId,
        recordedByMembershipId: adminMembershipId,
        recordedAt: now,
      },
    });
    autoOffsetCreated = true;
  }

  // ── Fixture 2: ALREADY_HAS_PLAN ──────────────────────────────────────────
  // RECORDED, con IncomeApplication canonical OFFSET → classifier returns ALREADY_HAS_PLAN
  const existingAlready = await prisma.income.findUnique({
    where: { id: LEGACY_BACKFIX_ALREADY_PLAN_ID },
    select: {
      id: true, tenantId: true, buildingId: true, period: true, categoryId: true,
      scopeType: true, destination: true, amountMinor: true, currencyCode: true, status: true,
    },
  });
  let alreadyPlanCreated = false;
  let alreadyPlanApplicationCreated = false;
  if (existingAlready) {
    // R2-4: Validate exact expected fixture identity.
    if (
      existingAlready.tenantId !== tenantId ||
      existingAlready.buildingId !== buildingA1Id ||
      existingAlready.period !== LEGACY_BACKFIX_ALREADY_PLAN_PERIOD ||
      existingAlready.categoryId !== categoryIncomeId ||
      existingAlready.scopeType !== 'BUILDING' ||
      existingAlready.destination !== 'APPLY_TO_EXPENSES' ||
      existingAlready.amountMinor !== 2500 ||
      existingAlready.currencyCode !== baseCurrency ||
      existingAlready.status !== 'RECORDED'
    ) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Legacy ALREADY income ${LEGACY_BACKFIX_ALREADY_PLAN_ID} exists with unexpected identity`,
      );
    }
    // R2-4: Validate pre-existing application count.
    const alreadyAppCount = await prisma.incomeApplication.count({
      where: { tenantId, incomeId: LEGACY_BACKFIX_ALREADY_PLAN_ID },
    });
    if (alreadyAppCount !== 1) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Legacy ALREADY income has ${alreadyAppCount} applications; expected exactly 1`,
      );
    }
  } else {
    await prisma.income.create({
      data: {
        id: LEGACY_BACKFIX_ALREADY_PLAN_ID,
        tenantId,
        buildingId: buildingA1Id,
        period: LEGACY_BACKFIX_ALREADY_PLAN_PERIOD,
        categoryId: categoryIncomeId,
        scopeType: 'BUILDING',
        destination: 'APPLY_TO_EXPENSES',
        amountMinor: 2500,
        currencyCode: baseCurrency,
        receivedDate: new Date(`${LEGACY_BACKFIX_ALREADY_PLAN_PERIOD}-05T00:00:00.000Z`),
        description: '[FIN07D:LEGACY_BACKFILL] ALREADY_HAS_PLAN 2025-11',
        status: 'RECORDED',
        createdByMembershipId: adminMembershipId,
        recordedByMembershipId: adminMembershipId,
        recordedAt: now,
      },
    });
    alreadyPlanCreated = true;
  }

  // R2-1: Canonical createPlan for ALREADY_HAS_PLAN (idempotent for same plan).
  // Check if application already exists before calling createPlan to report creation state.
  const alreadyAppBefore = await prisma.incomeApplication.findFirst({
    where: { tenantId, incomeId: LEGACY_BACKFIX_ALREADY_PLAN_ID },
    select: { id: true },
  });
  await applications.createPlan(
    tenantId,
    LEGACY_BACKFIX_ALREADY_PLAN_ID,
    adminMembershipId,
    adminRoles,
    {
      applications: [
        {
          destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
          amountMinor: 2500,
        },
      ],
    },
  );
  const alreadyAppAfter = await prisma.incomeApplication.findFirst({
    where: { tenantId, incomeId: LEGACY_BACKFIX_ALREADY_PLAN_ID },
    select: { id: true },
  });
  // R2-7: Report actual application creation/reuse state.
  alreadyPlanApplicationCreated = alreadyAppBefore === null && alreadyAppAfter !== null;

  // ── Fixture 3: REQUIRES_RESERVE_FUND ─────────────────────────────────────
  // RECORDED, RESERVE_FUND, no apps → classifier returns REQUIRES_RESERVE_FUND
  const existingReserve = await prisma.income.findUnique({
    where: { id: LEGACY_BACKFIX_RESERVE_FUND_ID },
    select: {
      id: true, tenantId: true, buildingId: true, period: true, categoryId: true,
      scopeType: true, destination: true, amountMinor: true, currencyCode: true, status: true,
    },
  });
  let reserveFundCreated = false;
  if (existingReserve) {
    // R2-4: Validate exact expected fixture identity.
    if (
      existingReserve.tenantId !== tenantId ||
      existingReserve.buildingId !== buildingA1Id ||
      existingReserve.period !== LEGACY_BACKFIX_RESERVE_FUND_PERIOD ||
      existingReserve.categoryId !== categoryIncomeId ||
      existingReserve.scopeType !== 'BUILDING' ||
      existingReserve.destination !== 'RESERVE_FUND' ||
      existingReserve.amountMinor !== 3000 ||
      existingReserve.currencyCode !== baseCurrency ||
      existingReserve.status !== 'RECORDED'
    ) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Legacy RESERVE income ${LEGACY_BACKFIX_RESERVE_FUND_ID} exists with unexpected identity`,
      );
    }
    // R2-4: Dirty guard — no applications expected.
    const reserveAppCount = await prisma.incomeApplication.count({
      where: { tenantId, incomeId: LEGACY_BACKFIX_RESERVE_FUND_ID },
    });
    if (reserveAppCount !== 0) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Legacy RESERVE income has ${reserveAppCount} applications; expected 0`,
      );
    }
  } else {
    await prisma.income.create({
      data: {
        id: LEGACY_BACKFIX_RESERVE_FUND_ID,
        tenantId,
        buildingId: buildingA1Id,
        period: LEGACY_BACKFIX_RESERVE_FUND_PERIOD,
        categoryId: categoryIncomeId,
        scopeType: 'BUILDING',
        destination: 'RESERVE_FUND',
        amountMinor: 3000,
        currencyCode: baseCurrency,
        receivedDate: new Date(`${LEGACY_BACKFIX_RESERVE_FUND_PERIOD}-05T00:00:00.000Z`),
        description: '[FIN07D:LEGACY_BACKFILL] REQUIRES_RESERVE_FUND 2025-09',
        status: 'RECORDED',
        createdByMembershipId: adminMembershipId,
        recordedByMembershipId: adminMembershipId,
        recordedAt: now,
      },
    });
    reserveFundCreated = true;
  }

  // ── Fixture 4: REQUIRES_SPECIAL_FUND ─────────────────────────────────────
  // RECORDED, SPECIAL_FUND, no apps → classifier returns REQUIRES_SPECIAL_FUND
  const existingSpecial = await prisma.income.findUnique({
    where: { id: LEGACY_BACKFIX_SPECIAL_FUND_ID },
    select: {
      id: true, tenantId: true, buildingId: true, period: true, categoryId: true,
      scopeType: true, destination: true, amountMinor: true, currencyCode: true, status: true,
    },
  });
  let specialFundCreated = false;
  if (existingSpecial) {
    // R2-4: Validate exact expected fixture identity.
    if (
      existingSpecial.tenantId !== tenantId ||
      existingSpecial.buildingId !== buildingA1Id ||
      existingSpecial.period !== LEGACY_BACKFIX_SPECIAL_FUND_PERIOD ||
      existingSpecial.categoryId !== categoryIncomeId ||
      existingSpecial.scopeType !== 'BUILDING' ||
      existingSpecial.destination !== 'SPECIAL_FUND' ||
      existingSpecial.amountMinor !== 4000 ||
      existingSpecial.currencyCode !== baseCurrency ||
      existingSpecial.status !== 'RECORDED'
    ) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Legacy SPECIAL income ${LEGACY_BACKFIX_SPECIAL_FUND_ID} exists with unexpected identity`,
      );
    }
    // R2-4: Dirty guard — no applications expected.
    const specialAppCount = await prisma.incomeApplication.count({
      where: { tenantId, incomeId: LEGACY_BACKFIX_SPECIAL_FUND_ID },
    });
    if (specialAppCount !== 0) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Legacy SPECIAL income has ${specialAppCount} applications; expected 0`,
      );
    }
  } else {
    await prisma.income.create({
      data: {
        id: LEGACY_BACKFIX_SPECIAL_FUND_ID,
        tenantId,
        buildingId: buildingA1Id,
        period: LEGACY_BACKFIX_SPECIAL_FUND_PERIOD,
        categoryId: categoryIncomeId,
        scopeType: 'BUILDING',
        destination: 'SPECIAL_FUND',
        amountMinor: 4000,
        currencyCode: baseCurrency,
        receivedDate: new Date(`${LEGACY_BACKFIX_SPECIAL_FUND_PERIOD}-05T00:00:00.000Z`),
        description: '[FIN07D:LEGACY_BACKFILL] REQUIRES_SPECIAL_FUND 2025-08',
        status: 'RECORDED',
        createdByMembershipId: adminMembershipId,
        recordedByMembershipId: adminMembershipId,
        recordedAt: now,
      },
    });
    specialFundCreated = true;
  }

  // ── Fixture 5: LIQUIDATION_CONFLICT ──────────────────────────────────────
  // RECORDED, APPLY_TO_EXPENSES, no apps, liquidación DRAFT para mismo período/building
  const existingConflict = await prisma.income.findUnique({
    where: { id: LEGACY_BACKFIX_CONFLICT_ID },
    select: {
      id: true, tenantId: true, buildingId: true, period: true, categoryId: true,
      scopeType: true, destination: true, amountMinor: true, currencyCode: true, status: true,
    },
  });
  let conflictCreated = false;
  if (existingConflict) {
    // R2-4: Validate exact expected fixture identity.
    if (
      existingConflict.tenantId !== tenantId ||
      existingConflict.buildingId !== buildingA1Id ||
      existingConflict.period !== LEGACY_BACKFIX_CONFLICT_PERIOD ||
      existingConflict.categoryId !== categoryIncomeId ||
      existingConflict.scopeType !== 'BUILDING' ||
      existingConflict.destination !== 'APPLY_TO_EXPENSES' ||
      existingConflict.amountMinor !== 1500 ||
      existingConflict.currencyCode !== baseCurrency ||
      existingConflict.status !== 'RECORDED'
    ) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Legacy CONFLICT income ${LEGACY_BACKFIX_CONFLICT_ID} exists with unexpected identity`,
      );
    }
    // R2-4: Dirty guard — no applications expected.
    const conflictAppCount = await prisma.incomeApplication.count({
      where: { tenantId, incomeId: LEGACY_BACKFIX_CONFLICT_ID },
    });
    if (conflictAppCount !== 0) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Legacy CONFLICT income has ${conflictAppCount} applications; expected 0`,
      );
    }
  } else {
    await prisma.income.create({
      data: {
        id: LEGACY_BACKFIX_CONFLICT_ID,
        tenantId,
        buildingId: buildingA1Id,
        period: LEGACY_BACKFIX_CONFLICT_PERIOD,
        categoryId: categoryIncomeId,
        scopeType: 'BUILDING',
        destination: 'APPLY_TO_EXPENSES',
        amountMinor: 1500,
        currencyCode: baseCurrency,
        receivedDate: new Date(`${LEGACY_BACKFIX_CONFLICT_PERIOD}-05T00:00:00.000Z`),
        description: '[FIN07D:LEGACY_BACKFILL] LIQUIDATION_CONFLICT 2025-12',
        status: 'RECORDED',
        createdByMembershipId: adminMembershipId,
        recordedByMembershipId: adminMembershipId,
        recordedAt: now,
      },
    });
    conflictCreated = true;
  }

  // R2-4: Validate conflict liquidation exact state.
  const existingConflictLiq = await prisma.liquidation.findUnique({
    where: { id: LEGACY_BACKFIX_CONFLICT_LIQUIDATION_ID },
    select: {
      id: true, tenantId: true, buildingId: true, period: true, status: true,
      totalAmountMinor: true, baseCurrency: true,
    },
  });
  let conflictLiquidationCreated = false;
  if (existingConflictLiq) {
    // R2-4: Validate exact expected conflict liquidation identity.
    if (
      existingConflictLiq.tenantId !== tenantId ||
      existingConflictLiq.buildingId !== buildingA1Id ||
      existingConflictLiq.period !== LEGACY_BACKFIX_CONFLICT_PERIOD ||
      existingConflictLiq.status !== 'DRAFT' ||
      existingConflictLiq.totalAmountMinor !== 10000 ||
      existingConflictLiq.baseCurrency !== baseCurrency
    ) {
      throw new Error(
        `TEST-FIXTURE-DIRTY: Legacy conflict liquidation ${LEGACY_BACKFIX_CONFLICT_LIQUIDATION_ID} exists with unexpected identity`,
      );
    }
  } else {
    await prisma.liquidation.create({
      data: {
        id: LEGACY_BACKFIX_CONFLICT_LIQUIDATION_ID,
        tenantId,
        buildingId: buildingA1Id,
        period: LEGACY_BACKFIX_CONFLICT_PERIOD,
        status: 'DRAFT',
        baseCurrency,
        totalAmountMinor: 10000,
        totalsByCurrency: { [baseCurrency]: 10000 },
        expenseSnapshot: [{
          expenseId: 'seed-legacy-backfill-conflict-expense',
          categoryName: 'Expensas Comunes',
          vendorName: null,
          amountMinor: 10000,
          currencyCode: baseCurrency,
          invoiceDate: `${LEGACY_BACKFIX_CONFLICT_PERIOD}-01`,
          description: `[FIN07D:LEGACY_BACKFILL] Conflict expense ${LEGACY_BACKFIX_CONFLICT_PERIOD}`,
          type: 'EXPENSE',
        }],
        unitCount: 1,
        generatedByMembershipId: adminMembershipId,
        valuationMode: null,
        grossExpenseAmountMinor: null,
        adjustmentAmountMinor: null,
        preIncomeAmountMinor: null,
        incomeOffsetAmountMinor: null,
        netDistributableAmountMinor: null,
        incomeOffsetSnapshot: Prisma.DbNull,
        incomeOffsetsByCurrency: Prisma.DbNull,
      },
    });
    conflictLiquidationCreated = true;
  }

  return {
    autoOffsetIncomeId: LEGACY_BACKFIX_AUTO_OFFSET_ID,
    autoOffsetCreated,
    alreadyPlanIncomeId: LEGACY_BACKFIX_ALREADY_PLAN_ID,
    alreadyPlanCreated,
    alreadyPlanApplicationId: alreadyAppAfter?.id ?? '',
    alreadyPlanApplicationCreated,
    reserveFundIncomeId: LEGACY_BACKFIX_RESERVE_FUND_ID,
    reserveFundCreated,
    specialFundIncomeId: LEGACY_BACKFIX_SPECIAL_FUND_ID,
    specialFundCreated,
    conflictIncomeId: LEGACY_BACKFIX_CONFLICT_ID,
    conflictCreated,
    conflictLiquidationId: LEGACY_BACKFIX_CONFLICT_LIQUIDATION_ID,
    conflictLiquidationCreated,
  };
}

export async function ensureSeedFinanceFixture(
  input: SeedFinanceFixtureInput,
): Promise<SeedFinanceFixtureResult> {
  const validators = new FinanzasValidators(
    input.prisma as never,
    new ResidentAccessService(input.prisma as never),
  );
  const auditService = new AuditService(input.prisma as never);
  const movementAllocation = new MovementAllocationService(
    input.prisma as never,
    auditService,
    validators,
  );
  const currencyConversion = new CurrencyConversionService(input.prisma as never);
  const incomes = new IncomesService(
    input.prisma as never,
    auditService,
    validators,
    movementAllocation,
    currencyConversion,
  );
  const applications = new IncomeApplicationsService(
    input.prisma as never,
    auditService,
    validators,
  );

  const services = { incomes, applications };

  const categoryIncomeId = await ensureCategory(input, {
    code: CATEGORY_INCOME_CODE,
    name: CATEGORY_INCOME_NAME,
    movementType: MovementType.INCOME,
  });
  const categoryExpenseId = await ensureCategory(input, {
    code: CATEGORY_EXPENSE_CODE,
    name: CATEGORY_EXPENSE_NAME,
    movementType: MovementType.EXPENSE,
  });

  const expense = await ensureValidatedExpense(input, categoryExpenseId, NORMAL_V3_EXPENSE_SPEC);

  const incomeBuilding = await ensureRecordedIncomeWithOffsetPlan(
    input,
    services,
    {
      descriptionTag: INCOME_BUILDING_TAG,
      amountMinor: 1500,
      period: FIN07D_NORMAL_V3_PERIOD,
      receivedDate: '2026-06-05T00:00:00.000Z',
      buildingId: input.buildingA1Id,
      scopeType: 'BUILDING',
    },
    categoryIncomeId,
  );

  const incomeShared = await ensureRecordedIncomeWithOffsetPlan(
    input,
    services,
    {
      descriptionTag: INCOME_SHARED_TAG,
      amountMinor: 7000,
      period: FIN07D_NORMAL_V3_PERIOD,
      receivedDate: '2026-06-05T00:00:00.000Z',
      buildingId: null,
      scopeType: 'TENANT_SHARED',
      allocations: [
        { buildingId: input.buildingA1Id, percentage: 60 },
        { buildingId: input.buildingA2Id, percentage: 40 },
      ],
    },
    categoryIncomeId,
  );

  const funds = await ensureSeedFunds({
    prisma: input.prisma,
    tenantId: input.tenantId,
    adminMembershipId: input.adminMembershipId,
    adminRoles: input.adminRoles,
  });

  const policy = await ensureSeedPolicy(input, {
    reserveFundId: funds.reserveFundId,
    specialFundId: funds.specialFundId,
  });

  // ── ZERO_NET (FIN-06 boundary: preIncome == offsets → net == 0) ──────────
  const zeroNetExpense = await ensureValidatedExpense(input, categoryExpenseId, {
    period: FIN07D_ZERO_NET_PERIOD,
    amountMinor: FIN07D_ZERO_NET_EXPENSE_AMOUNT,
    descriptionTag: ZERO_NET_EXPENSE_TAG,
    invoiceDate: new Date('2026-07-03T00:00:00.000Z'),
    validatedAt: new Date('2026-07-04T00:00:00.000Z'),
  });

  const zeroNetIncome = await ensureRecordedIncomeWithOffsetPlan(
    input,
    services,
    {
      descriptionTag: ZERO_NET_INCOME_TAG,
      amountMinor: FIN07D_ZERO_NET_INCOME_AMOUNT,
      period: FIN07D_ZERO_NET_PERIOD,
      receivedDate: '2026-07-05T00:00:00.000Z',
      buildingId: input.buildingA1Id,
      scopeType: 'BUILDING',
    },
    categoryIncomeId,
  );

  const zeroNetApplication = await input.prisma.incomeApplication.findFirstOrThrow({
    where: {
      tenantId: input.tenantId,
      incomeId: zeroNetIncome.id,
      destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
    },
    select: { id: true },
  });

  // ── Historical V1/V2 (FIN-07D Phase 2A HISTORICAL) ────────────────────────
  const historical = await ensureHistoricalV1V2Liquidations({
    prisma: input.prisma,
    tenantId: input.tenantId,
    adminMembershipId: input.adminMembershipId,
    buildingA1Id: input.buildingA1Id,
    baseCurrency: input.baseCurrency,
  });

  // ── Legacy Income Backfill Fixtures (FIN-07D Phase 2A LEGACY_BACKFILL) ──
  const legacyBackfill = await ensureLegacyIncomeBackfillFixtures({
    prisma: input.prisma,
    tenantId: input.tenantId,
    adminMembershipId: input.adminMembershipId,
    adminRoles: input.adminRoles,
    buildingA1Id: input.buildingA1Id,
    baseCurrency: input.baseCurrency,
    categoryIncomeId,
    applications,
  });

  return {
    categoryIncomeId,
    categoryExpenseId,
    expenseId: expense.id,
    expenseCreated: expense.created,
    incomeBuildingId: incomeBuilding.id,
    incomeBuildingCreated: incomeBuilding.created,
    incomeSharedId: incomeShared.id,
    incomeSharedCreated: incomeShared.created,
    reserveFundId: funds.reserveFundId,
    reserveFundCreated: funds.reserveFundCreated,
    specialFundId: funds.specialFundId,
    specialFundCreated: funds.specialFundCreated,
    policyCategoryId: policy.policyCategoryId,
    policyCategoryCreated: policy.policyCategoryCreated,
    policyId: policy.policyId,
    policyCreated: policy.policyCreated,
    policyActiveVersionId: policy.policyActiveVersionId,
    activeVersionCount: policy.activeVersionCount,
    ruleOffsetId: policy.ruleOffsetId,
    ruleReserveId: policy.ruleReserveId,
    ruleSpecialId: policy.ruleSpecialId,
    totalBps: policy.totalBps,
    zeroNetExpenseId: zeroNetExpense.id,
    zeroNetExpenseCreated: zeroNetExpense.created,
    zeroNetIncomeId: zeroNetIncome.id,
    zeroNetIncomeCreated: zeroNetIncome.created,
    zeroNetApplicationId: zeroNetApplication.id,
    historicalV1LiquidationId: historical.v1LiquidationId,
    historicalV1Created: historical.v1Created,
    historicalV1ChargeCount: historical.v1ChargeCount,
    historicalV2LiquidationId: historical.v2LiquidationId,
    historicalV2Created: historical.v2Created,
    historicalV2ChargeCount: historical.v2ChargeCount,
    legacyBackfillAutoOffsetIncomeId: legacyBackfill.autoOffsetIncomeId,
    legacyBackfillAutoOffsetCreated: legacyBackfill.autoOffsetCreated,
    legacyBackfillAlreadyPlanIncomeId: legacyBackfill.alreadyPlanIncomeId,
    legacyBackfillAlreadyPlanCreated: legacyBackfill.alreadyPlanCreated,
    legacyBackfillAlreadyPlanApplicationId: legacyBackfill.alreadyPlanApplicationId,
    legacyBackfillAlreadyPlanApplicationCreated: legacyBackfill.alreadyPlanApplicationCreated,
    legacyBackfillReserveFundIncomeId: legacyBackfill.reserveFundIncomeId,
    legacyBackfillReserveFundCreated: legacyBackfill.reserveFundCreated,
    legacyBackfillSpecialFundIncomeId: legacyBackfill.specialFundIncomeId,
    legacyBackfillSpecialFundCreated: legacyBackfill.specialFundCreated,
    legacyBackfillConflictIncomeId: legacyBackfill.conflictIncomeId,
    legacyBackfillConflictCreated: legacyBackfill.conflictCreated,
    legacyBackfillConflictLiquidationId: legacyBackfill.conflictLiquidationId,
    legacyBackfillConflictLiquidationCreated: legacyBackfill.conflictLiquidationCreated,
  };
}
