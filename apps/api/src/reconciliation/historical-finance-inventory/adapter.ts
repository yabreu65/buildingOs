import { PrismaService } from '../../prisma/prisma.service';
import { classifyFunctionalSnapshot } from '../../finanzas/functional-snapshot';
import {
  FINANCE_INVENTORY_ENTITIES,
  FinanceInventoryCounterpartEvidence,
  FinanceInventoryEntity,
  FinanceInventoryRecord,
  FinancePage,
  FinancePageReader,
  FinancePageRequest,
  ReadOnlyFinanceInventoryAdapter,
} from './contracts';

export { FINANCE_INVENTORY_ENTITIES } from './contracts';

const SUPPORTED_CURRENCIES = new Set(['ARS', 'USD', 'VES', 'COP']);

interface BuildingEvidence {
  readonly id: string;
  readonly tenantId: string;
}

interface UnitEvidence {
  readonly tenantId: string;
  readonly buildingId: string;
}

function assertPageRequest(request: FinancePageRequest): void {
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) {
    throw new RangeError('Historical finance inventory page limits must be integers from 1 through 100');
  }
}

function pageArgs(request: FinancePageRequest): { readonly where?: { readonly id: { readonly gt: string } }; readonly orderBy: { readonly id: 'asc' }; readonly take: number } {
  return {
    ...(request.cursor === undefined ? {} : { where: { id: { gt: request.cursor } } }),
    orderBy: { id: 'asc' },
    take: request.limit,
  };
}

function toPage<Row extends { readonly id: string }>(
  rows: readonly Row[],
  request: FinancePageRequest,
  map: (row: Row) => FinanceInventoryRecord,
): FinancePage {
  const records = rows.map(map);
  const nextRow = rows.length === request.limit ? rows[rows.length - 1] : undefined;
  return {
    records,
    ...(nextRow === undefined ? {} : { nextCursor: nextRow.id }),
  };
}

function currencySupported(currencyCode: string | null | undefined): boolean {
  return currencyCode !== undefined && currencyCode !== null && SUPPORTED_CURRENCIES.has(currencyCode);
}

function counterpartEvidence(
  counterpart: { readonly tenantId: string } | null | undefined,
  currencyCode?: string | null,
): FinanceInventoryCounterpartEvidence {
  const present = counterpart !== null && counterpart !== undefined;
  return {
    present,
    ...(present ? { tenantToken: counterpart.tenantId } : {}),
    ...(present && currencyCode !== null && currencyCode !== undefined
      ? { currencyCode, currencySupported: currencySupported(currencyCode) }
      : {}),
  };
}

function validTenantBuildingUnitRelationship(
  tenantId: string,
  building: BuildingEvidence | null | undefined,
  unit?: UnitEvidence | null,
): boolean {
  return building !== null
    && building !== undefined
    && building.tenantId === tenantId
    && (unit === null || unit === undefined || (unit.tenantId === tenantId && unit.buildingId === building.id));
}

function validOptionalBuildingRelationship(
  tenantId: string,
  building: BuildingEvidence | null,
  requiresBuilding: boolean,
): boolean {
  return !requiresBuilding
    ? building === null || building.tenantId === tenantId
    : building !== null && building.tenantId === tenantId;
}

function isSafeInteger(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isSafeInteger(value);
}

function isNonNegativeSafeInteger(value: number | null | undefined): value is number {
  return isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: number | null | undefined): value is number {
  return isSafeInteger(value) && value > 0;
}

function snapshotVersion(snapshot: unknown): number | undefined {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    return undefined;
  }
  const version = (snapshot as { readonly version?: unknown }).version;
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
}

function liquidationRepresentation(row: {
  readonly publicationSnapshot: unknown;
  readonly publicationIntegrityVersion: number | null;
  readonly valuationMode: string | null;
  readonly totalAmountMinor: number;
  readonly preIncomeAmountMinor: number | null;
  readonly incomeOffsetAmountMinor: number | null;
  readonly netDistributableAmountMinor: number | null;
}): string {
  if (
    row.totalAmountMinor === 0
    && row.preIncomeAmountMinor !== null
    && row.preIncomeAmountMinor > 0
    && row.incomeOffsetAmountMinor === row.preIncomeAmountMinor
    && row.netDistributableAmountMinor === 0
  ) {
    return 'ZERO_NET';
  }
  const version = snapshotVersion(row.publicationSnapshot);
  if (version === 1) return 'V1';
  if (version === 2) return 'V2';
  if (version === 3 || row.publicationIntegrityVersion !== null || row.valuationMode !== null) return 'V3';
  return 'CURRENT';
}

function validLiquidationShape(row: {
  readonly representation: string;
  readonly valuationMode: string | null;
  readonly totalAmountMinor: number;
  readonly grossExpenseAmountMinor: number | null;
  readonly adjustmentAmountMinor: number | null;
  readonly preIncomeAmountMinor: number | null;
  readonly incomeOffsetAmountMinor: number | null;
  readonly netDistributableAmountMinor: number | null;
}): boolean {
  const legacyValues = [
    row.grossExpenseAmountMinor,
    row.adjustmentAmountMinor,
    row.preIncomeAmountMinor,
    row.incomeOffsetAmountMinor,
    row.netDistributableAmountMinor,
  ];
  if (row.representation === 'V1') {
    return row.valuationMode === null && legacyValues.every((value) => value === null);
  }
  if (row.representation === 'V2') {
    return row.valuationMode === 'FUNCTIONAL' && legacyValues.every((value) => value === null);
  }
  if (row.representation !== 'V3' && row.representation !== 'ZERO_NET') {
    return true;
  }
  const [gross, adjustment, preIncome, offset, net] = legacyValues;
  return isNonNegativeSafeInteger(gross)
    && isNonNegativeSafeInteger(adjustment)
    && isNonNegativeSafeInteger(preIncome)
    && isNonNegativeSafeInteger(offset)
    && isNonNegativeSafeInteger(net)
    && preIncome === gross + adjustment
    && net === preIncome - offset
    && row.totalAmountMinor === net;
}

function paymentAllocationCompatibility(row: {
  readonly amount: number;
  readonly paymentOriginalAmountMinor: number | null;
  readonly payment: {
    readonly amount: number;
    readonly currency: string;
    readonly functionalAmountMinor: number | null;
    readonly functionalCurrencyCode: string | null;
    readonly exchangeRateId: string | null;
    readonly exchangeRateValue: { readonly toString: () => string } | null;
    readonly exchangeRateDirection: string | null;
    readonly exchangeRateEffectiveAt: Date | null;
    readonly conversionDate: Date | null;
  };
  readonly charge: { readonly currency: string };
}): { readonly currencyCompatible: boolean; readonly currencySupported: boolean; readonly invariantValid: boolean; readonly representation?: string } {
  const snapshotState = classifyFunctionalSnapshot(row.payment);
  const crossCurrency = row.payment.currency !== row.charge.currency;
  const amountValid = isPositiveSafeInteger(row.amount)
    && isPositiveSafeInteger(row.payment.amount)
    && (!crossCurrency || snapshotState !== 'COMPLETE' || row.amount <= (row.payment.functionalAmountMinor ?? 0))
    && (crossCurrency || row.amount <= row.payment.amount);
  const originalAmountValid = row.paymentOriginalAmountMinor === null
    || (isPositiveSafeInteger(row.paymentOriginalAmountMinor)
      && row.paymentOriginalAmountMinor <= row.payment.amount
      && (!crossCurrency || row.paymentOriginalAmountMinor > 0)
      && (crossCurrency || row.paymentOriginalAmountMinor === row.amount));
  const supported = currencySupported(row.payment.currency)
    && currencySupported(row.charge.currency)
    && (snapshotState !== 'COMPLETE' || currencySupported(row.payment.functionalCurrencyCode));

  if (!crossCurrency) {
    return {
      currencyCompatible: true,
      currencySupported: supported,
      invariantValid: amountValid && originalAmountValid && snapshotState !== 'PARTIAL_INVALID',
    };
  }

  if (snapshotState === 'PARTIAL_INVALID') {
    return { currencyCompatible: false, currencySupported: supported, invariantValid: false };
  }
  if (row.paymentOriginalAmountMinor === null || snapshotState === 'LEGACY_NULL') {
    return {
      currencyCompatible: true,
      currencySupported: supported,
      invariantValid: amountValid && originalAmountValid,
      representation: 'LEGACY_PAYMENT_ALLOCATION_CROSS',
    };
  }

  const canonicalSnapshot = row.payment.functionalCurrencyCode === row.charge.currency
    && isPositiveSafeInteger(row.payment.functionalAmountMinor);
  return {
    currencyCompatible: canonicalSnapshot,
    currencySupported: supported,
    invariantValid: amountValid && originalAmountValid && canonicalSnapshot,
  };
}

/**
 * Creates the scanner's only data-access capability. It deliberately exposes
 * page reads and cannot expose finance mutations to scanner callers.
 */
export function createReadOnlyFinanceInventoryAdapter(
  readers: Readonly<Record<FinanceInventoryEntity, FinancePageReader>>,
): ReadOnlyFinanceInventoryAdapter {
  return {
    async listPage(entity: FinanceInventoryEntity, request: FinancePageRequest): Promise<FinancePage> {
      assertPageRequest(request);
      return readers[entity].listPage(request);
    },
  };
}

/**
 * Prisma-backed implementation of the inventory's read-only capability.
 *
 * Every query is an ID-ordered `findMany` read with an ID cursor predicate.
 * The returned interface exposes only `listPage`, so scanner consumers cannot
 * access Prisma or a mutation-shaped method through this adapter.
 */
export function createPrismaReadOnlyFinanceInventoryAdapter(
  prisma: PrismaService,
): ReadOnlyFinanceInventoryAdapter {
  return {
    async listPage(entity: FinanceInventoryEntity, request: FinancePageRequest): Promise<FinancePage> {
      assertPageRequest(request);
      switch (entity) {
        case 'liquidations': {
          const rows = await prisma.liquidation.findMany({
            ...pageArgs(request),
            select: {
              id: true,
              tenantId: true,
              baseCurrency: true,
              publicationIntegrityVersion: true,
                  publicationSnapshot: true,
                  valuationMode: true,
                  totalAmountMinor: true,
                  grossExpenseAmountMinor: true,
                  adjustmentAmountMinor: true,
                  preIncomeAmountMinor: true,
                  incomeOffsetAmountMinor: true,
                  netDistributableAmountMinor: true,
              building: { select: { id: true, tenantId: true } },
            },
          });
          return toPage(rows, request, (row) => ({
            id: row.id,
            createdSequence: 0,
            tenantToken: row.tenantId,
            currencyCode: row.baseCurrency,
            currencySupported: currencySupported(row.baseCurrency),
            representation: liquidationRepresentation(row),
            invariantValid: validTenantBuildingUnitRelationship(row.tenantId, row.building)
              && validLiquidationShape({ ...row, representation: liquidationRepresentation(row) }),
          }));
        }
        case 'funds': {
              const rows = await prisma.fund.findMany({
                ...pageArgs(request),
                select: {
                  id: true,
                  tenantId: true,
                  scopeType: true,
                  building: { select: { id: true, tenantId: true } },
                },
              });
              return toPage(rows, request, (row) => ({
                id: row.id,
                createdSequence: 0,
                tenantToken: row.tenantId,
                invariantValid: row.scopeType === 'BUILDING'
                  ? row.building !== null && row.building.tenantId === row.tenantId
                  : row.scopeType === 'TENANT' && row.building === null,
              }));
            }
            case 'fundTransactions': {
              const rows = await prisma.fundTransaction.findMany({
                ...pageArgs(request),
                select: {
                  id: true,
                  tenantId: true,
                  fundId: true,
                  direction: true,
                  amountMinor: true,
                  currencyCode: true,
                  fund: { select: { id: true, tenantId: true } },
                  incomeApplication: {
                    select: {
                      tenantId: true,
                      fundId: true,
                      destinationType: true,
                      amountMinor: true,
                      currencyCode: true,
                    },
                  },
                },
              });
              return toPage(rows, request, (row) => {
                const application = row.incomeApplication;
                const applicationValid = application === null || (
                  application.tenantId === row.tenantId
                  && application.fundId === row.fundId
                  && application.destinationType === 'FUND'
                  && application.amountMinor === row.amountMinor
                  && application.currencyCode === row.currencyCode
                  && row.direction === 'CREDIT'
                );
                return {
                  id: row.id,
                  createdSequence: 0,
                  tenantToken: row.tenantId,
                  currencyCode: row.currencyCode,
                  currencySupported: currencySupported(row.currencyCode),
                  invariantValid: isPositiveSafeInteger(row.amountMinor)
                    && row.fund.tenantId === row.tenantId
                    && applicationValid,
                  requiresCounterpart: true,
                  counterpartEntity: 'funds',
                  counterpartId: row.fundId,
                counterpartEvidence: counterpartEvidence(row.fund),
                };
              });
            }
            case 'charges': {
          const rows = await prisma.charge.findMany({
            ...pageArgs(request),
            select: {
              id: true,
              tenantId: true,
              buildingId: true,
              currency: true,
              liquidationId: true,
                  liquidation: { select: { tenantId: true, baseCurrency: true } },
              building: { select: { id: true, tenantId: true } },
              unit: { select: { tenantId: true, buildingId: true } },
            },
          });
          return toPage(rows, request, (row) => ({
            id: row.id,
            createdSequence: 0,
            tenantToken: row.tenantId,
            currencyCode: row.currency,
            currencySupported: currencySupported(row.currency),
            invariantValid: validTenantBuildingUnitRelationship(row.tenantId, row.building, row.unit),
            ...(row.liquidationId === null ? {} : {
              requiresCounterpart: true,
              counterpartEntity: 'liquidations' as const,
              counterpartId: row.liquidationId,
                  counterpartEvidence: counterpartEvidence(row.liquidation, row.liquidation?.baseCurrency),
              requiresCurrency: true,
            }),
          }));
        }
        case 'payments': {
          const rows = await prisma.payment.findMany({
            ...pageArgs(request),
            select: {
              id: true,
              tenantId: true,
              currency: true,
              building: { select: { id: true, tenantId: true } },
              unit: { select: { tenantId: true, buildingId: true } },
            },
          });
          return toPage(rows, request, (row) => ({
            id: row.id,
            createdSequence: 0,
            tenantToken: row.tenantId,
            currencyCode: row.currency,
            currencySupported: currencySupported(row.currency),
            invariantValid: validTenantBuildingUnitRelationship(row.tenantId, row.building, row.unit),
          }));
        }
        case 'paymentAllocations': {
          const rows = await prisma.paymentAllocation.findMany({
            ...pageArgs(request),
            select: {
              id: true,
              tenantId: true,
              paymentId: true,
                  amount: true,
                  paymentOriginalAmountMinor: true,
              chargeId: true,
              payment: {
                    select: {
                      id: true,
                      tenantId: true,
                      buildingId: true,
                      unitId: true,
                      amount: true,
                      currency: true,
                      functionalAmountMinor: true,
                      functionalCurrencyCode: true,
                      exchangeRateId: true,
                      exchangeRateValue: true,
                      exchangeRateDirection: true,
                      exchangeRateEffectiveAt: true,
                      conversionDate: true,
                    },
                  },
              charge: { select: { id: true, tenantId: true, buildingId: true, unitId: true, currency: true } },
            },
          });
          return toPage(rows, request, (row) => ({
            id: row.id,
            createdSequence: 0,
            tenantToken: row.tenantId,
            currencyCode: row.charge.currency,
            currencySupported: paymentAllocationCompatibility(row).currencySupported,
                currencyCompatible: paymentAllocationCompatibility(row).currencyCompatible,
                ...(paymentAllocationCompatibility(row).representation === undefined ? {} : {
                  representation: paymentAllocationCompatibility(row).representation,
                }),
            invariantValid: row.payment.tenantId === row.tenantId
              && row.charge.tenantId === row.tenantId
              && row.payment.buildingId === row.charge.buildingId
              && row.payment.unitId === row.charge.unitId
                  && paymentAllocationCompatibility(row).invariantValid,
            requiresCounterpart: true,
            counterpartEntity: 'payments',
            counterpartId: row.paymentId,
                counterpartEvidence: counterpartEvidence(row.payment, row.payment.currency),
            requiresCurrency: true,
          }));
        }
        case 'expenses': {
          const rows = await prisma.expense.findMany({
            ...pageArgs(request),
            select: {
              id: true,
              tenantId: true,
              scopeType: true,
              currencyCode: true,
              building: { select: { id: true, tenantId: true } },
            },
          });
          return toPage(rows, request, (row) => ({
            id: row.id,
            createdSequence: 0,
            tenantToken: row.tenantId,
            currencyCode: row.currencyCode,
            currencySupported: currencySupported(row.currencyCode),
            invariantValid: validOptionalBuildingRelationship(row.tenantId, row.building, row.scopeType === 'BUILDING'),
          }));
        }
        case 'adjustments': {
          const rows = await prisma.adjustment.findMany({
            ...pageArgs(request),
            select: {
              id: true,
              tenantId: true,
              currencyCode: true,
              building: { select: { id: true, tenantId: true } },
            },
          });
          return toPage(rows, request, (row) => ({
            id: row.id,
            createdSequence: 0,
            tenantToken: row.tenantId,
            currencyCode: row.currencyCode,
            currencySupported: currencySupported(row.currencyCode),
            invariantValid: validTenantBuildingUnitRelationship(row.tenantId, row.building),
          }));
        }
        case 'incomes': {
          const rows = await prisma.income.findMany({
            ...pageArgs(request),
            select: {
              id: true,
              tenantId: true,
              period: true,
              scopeType: true,
              status: true,
              destination: true,
              currencyCode: true,
              building: { select: { id: true, tenantId: true } },
              applications: { select: { id: true } },
              allocations: { select: { buildingId: true, amountMinor: true, building: { select: { tenantId: true } } } },
            },
          });
          const liquidationLookupKeys = new Map<string, { readonly tenantId: string; readonly period: string; readonly buildingId: string }>();
          for (const row of rows) {
            if (row.status !== 'RECORDED' || row.applications.length > 0 || row.destination !== 'APPLY_TO_EXPENSES') {
              continue;
            }
            const relevantBuildingIds = row.scopeType === 'BUILDING'
              ? row.building === null ? [] : [row.building.id]
              : row.allocations
                .filter((allocation) => allocation.amountMinor !== null && allocation.amountMinor > 0)
                .map((allocation) => allocation.buildingId);
            for (const buildingId of relevantBuildingIds) {
              const key = `${row.tenantId}:${row.period}:${buildingId}`;
              liquidationLookupKeys.set(key, { tenantId: row.tenantId, period: row.period, buildingId });
            }
          }
          const lookupKeys = [...liquidationLookupKeys.values()].sort((left, right) => (
            `${left.tenantId}:${left.period}:${left.buildingId}`.localeCompare(
              `${right.tenantId}:${right.period}:${right.buildingId}`,
            )
          ));
          const liquidations = lookupKeys.length === 0
            ? []
            : await prisma.liquidation.findMany({
              where: {
                OR: lookupKeys.map(({ tenantId, period, buildingId }) => ({ tenantId, period, buildingId })),
                status: { in: ['DRAFT', 'REVIEWED', 'PUBLISHED'] },
              },
              select: { tenantId: true, period: true, buildingId: true },
            });
          const liquidationConflicts = new Set(
            liquidations.map((liquidation) => `${liquidation.tenantId}:${liquidation.period}:${liquidation.buildingId}`),
          );
          const records = rows.map((row) => {
            const legacyCandidate = row.status === 'RECORDED' && row.applications.length === 0;
            const relevantBuildingIds = row.scopeType === 'BUILDING'
              ? row.building === null ? [] : [row.building.id]
              : row.allocations
                .filter((allocation) => allocation.amountMinor !== null && allocation.amountMinor > 0)
                .map((allocation) => allocation.buildingId);
            const liquidationConflict = legacyCandidate
              && row.destination === 'APPLY_TO_EXPENSES'
              && relevantBuildingIds.some((buildingId) => (
                liquidationConflicts.has(`${row.tenantId}:${row.period}:${buildingId}`)
              ));
            const representation = !legacyCandidate
              ? 'CURRENT'
              : row.destination === 'APPLY_TO_EXPENSES'
                ? liquidationConflict ? 'LEGACY_INCOME_LIQUIDATION_CONFLICT' : 'LEGACY_INCOME'
                : 'LEGACY_INCOME_REQUIRES_FUND';
            return {
              id: row.id,
              createdSequence: 0,
              tenantToken: row.tenantId,
              currencyCode: row.currencyCode,
              currencySupported: currencySupported(row.currencyCode),
              representation,
              invariantValid: validOptionalBuildingRelationship(row.tenantId, row.building, row.scopeType === 'BUILDING')
                && row.allocations.every((allocation) => allocation.building.tenantId === row.tenantId),
            };
          });
          return toPage(records, request, (record) => record);
        }
        case 'incomeApplications': {
          const rows = await prisma.incomeApplication.findMany({
            ...pageArgs(request),
            select: {
              id: true,
              tenantId: true,
              incomeId: true,
              destinationType: true,
              fundId: true,
              amountMinor: true,
              currencyCode: true,
              income: { select: { id: true, tenantId: true, currencyCode: true } },
              fund: { select: { id: true, tenantId: true } },
              fundTransaction: {
                select: { tenantId: true, fundId: true, direction: true, amountMinor: true, currencyCode: true },
              },
            },
          });
          return toPage(rows, request, (row) => {
            const fundProvenanceValid = row.destinationType !== 'FUND' || (
              row.fundId !== null
              && row.fund !== null
              && row.fund.tenantId === row.tenantId
              && row.fundTransaction !== null
              && row.fundTransaction.tenantId === row.tenantId
              && row.fundTransaction.fundId === row.fundId
              && row.fundTransaction.direction === 'CREDIT'
              && row.fundTransaction.amountMinor === row.amountMinor
              && row.fundTransaction.currencyCode === row.currencyCode
            );
            return {
              id: row.id,
              createdSequence: 0,
              tenantToken: row.tenantId,
              currencyCode: row.currencyCode,
              currencySupported: currencySupported(row.currencyCode),
              invariantValid: row.income.tenantId === row.tenantId
                && row.income.currencyCode === row.currencyCode
                && isPositiveSafeInteger(row.amountMinor)
                && fundProvenanceValid,
              requiresCounterpart: true,
              counterpartEntity: 'incomes',
              counterpartId: row.incomeId,
                  counterpartEvidence: counterpartEvidence(row.income, row.income.currencyCode),
              requiresCurrency: true,
            };
          });
        }
        case 'movementAllocations': {
          const rows = await prisma.movementAllocation.findMany({
            ...pageArgs(request),
            select: {
              id: true,
              tenantId: true,
              expenseId: true,
              incomeId: true,
              currencyCode: true,
              building: { select: { id: true, tenantId: true } },
              expense: { select: { tenantId: true, currencyCode: true } },
              income: { select: { tenantId: true, currencyCode: true } },
            },
          });
          return toPage(rows, request, (row) => {
            const hasExpense = row.expenseId !== null && row.expense !== null;
            const hasIncome = row.incomeId !== null && row.income !== null;
            const counterpartEntity = hasExpense ? 'expenses' : 'incomes';
            const counterpartId = hasExpense ? row.expenseId : row.incomeId;
            const counterpart = hasExpense ? row.expense : row.income;
            return {
              id: row.id,
              createdSequence: 0,
              tenantToken: row.tenantId,
              currencyCode: row.currencyCode ?? undefined,
              currencySupported: currencySupported(row.currencyCode),
              invariantValid: hasExpense !== hasIncome
                && validTenantBuildingUnitRelationship(row.tenantId, row.building)
                && counterpart?.tenantId === row.tenantId,
              requiresCounterpart: true,
              counterpartEntity,
              ...(counterpartId === null ? {} : { counterpartId }),
                  counterpartEvidence: counterpartEvidence(counterpart, counterpart?.currencyCode),
              requiresCurrency: true,
            };
          });
        }
        case 'liquidationIncomeOffsets': {
          const rows = await prisma.liquidationIncomeOffset.findMany({
            ...pageArgs(request),
            select: {
              id: true,
              tenantId: true,
              incomeApplicationId: true,
              buildingId: true,
              originalAmountMinor: true,
              valuedAmountMinor: true,
              currencyCode: true,
              baseCurrency: true,
              liquidation: { select: { tenantId: true, buildingId: true, baseCurrency: true, valuationMode: true } },
              incomeApplication: { select: { id: true, tenantId: true, amountMinor: true, currencyCode: true } },
            },
          });
          return toPage(rows, request, (row) => ({
            id: row.id,
            createdSequence: 0,
            tenantToken: row.tenantId,
            currencyCode: row.currencyCode,
            currencySupported: currencySupported(row.currencyCode)
              && currencySupported(row.baseCurrency)
              && currencySupported(row.liquidation.baseCurrency),
            invariantValid: row.liquidation.tenantId === row.tenantId
              && row.incomeApplication.tenantId === row.tenantId
              && row.buildingId === row.liquidation.buildingId
              && row.baseCurrency === row.liquidation.baseCurrency
              && row.currencyCode === row.incomeApplication.currencyCode
              && isPositiveSafeInteger(row.originalAmountMinor)
              && isPositiveSafeInteger(row.valuedAmountMinor)
              && row.originalAmountMinor <= row.incomeApplication.amountMinor
              && (row.liquidation.valuationMode !== 'LEGACY_NOMINAL'
                || (row.currencyCode === row.baseCurrency && row.originalAmountMinor === row.valuedAmountMinor)),
            requiresCounterpart: true,
            counterpartEntity: 'incomeApplications',
            counterpartId: row.incomeApplicationId,
                counterpartEvidence: counterpartEvidence(row.incomeApplication, row.incomeApplication.currencyCode),
            requiresCurrency: true,
          }));
        }
        case 'currencies': {
          const rows = await prisma.tenant.findMany({
            ...pageArgs(request),
            select: { id: true, currency: true },
          });
          return toPage(rows, request, (row) => ({
            id: row.id,
            createdSequence: 0,
            tenantToken: row.id,
            currencyCode: row.currency,
            currencySupported: currencySupported(row.currency),
          }));
        }
        case 'tenantRelationships': {
          const rows = await prisma.unit.findMany({
            ...pageArgs(request),
            select: {
              id: true,
              tenantId: true,
              building: { select: { id: true, tenantId: true } },
            },
          });
          return toPage(rows, request, (row) => ({
            id: row.id,
            createdSequence: 0,
            tenantToken: row.tenantId,
            invariantValid: validTenantBuildingUnitRelationship(row.tenantId, row.building),
          }));
        }
      }
    },
  };
}

/**
 * Rejects a prohibited operation before it can reach a data provider. This is
 * intentionally separate from the read-only capability rather than a method
 * on it, so scanner code has no mutation-shaped API to call.
 */
export function rejectMutationAttempt(operation: string): never {
  throw new Error(`Historical finance inventory rejects ${operation} operations`);
}
