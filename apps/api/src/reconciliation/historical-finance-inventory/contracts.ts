/**
 * Synthetic sources may use creation sequence followed by ID. Prisma-backed
 * sources use a constant sequence and order by immutable ID, which keeps the
 * opaque pagination cursor deterministic without requiring a mutable sequence.
 */
export interface HistoricalFinanceRecord {
  readonly id: string;
  readonly createdSequence: number;
}

export const FINANCE_CURRENCY_STATUSES = [
  'CANONICAL_CURRENT',
  'LEGACY_STORED',
  'MALFORMED',
] as const;

export type FinanceCurrencyStatus = (typeof FINANCE_CURRENCY_STATUSES)[number];

/** Minimal relation evidence that lets paged scans classify a counterpart without retaining it. */
export interface FinanceInventoryCounterpartEvidence {
  readonly present: boolean;
  readonly tenantToken?: string;
  readonly currencyCode?: string;
  readonly currencyStatuses?: readonly FinanceCurrencyStatus[];
}

/** Synthetic and provider-normalized data used only for read-only validation. */
export interface FinanceInventoryRecord extends HistoricalFinanceRecord {
  readonly tenantToken?: string;
  readonly currencyCode?: string;
  readonly currencyStatuses?: readonly FinanceCurrencyStatus[];
  /** Explicit persisted compatibility evidence; omitted keeps exact-currency matching. */
  readonly currencyCompatible?: boolean;
  readonly representation?: string;
  readonly invariantValid?: boolean;
  readonly requiresCounterpart?: boolean;
  readonly counterpartEntity?: FinanceInventoryEntity;
  readonly counterpartId?: string;
  readonly counterpartEvidence?: FinanceInventoryCounterpartEvidence;
  readonly requiresCurrency?: boolean;
}

export const FINANCE_INVENTORY_ENTITIES = [
  'liquidations',
  'charges',
  'funds',
  'fundTransactions',
  'payments',
  'paymentAllocations',
  'expenses',
  'adjustments',
  'incomes',
  'incomeApplications',
  'movementAllocations',
  'liquidationIncomeOffsets',
  'currencies',
  'tenantRelationships',
] as const;

export type FinanceInventoryEntity = (typeof FINANCE_INVENTORY_ENTITIES)[number];

export interface FinancePageRequest {
  readonly limit: number;
  /** Opaque adapter cursor; the Prisma adapter advances only by immutable ID. */
  readonly cursor?: string;
}

export interface FinancePage {
  readonly records: readonly FinanceInventoryRecord[];
  readonly nextCursor?: string;
}

/** A capability-limited reader for one deterministically ordered entity. */
export interface FinancePageReader {
  listPage(request: FinancePageRequest): Promise<FinancePage>;
}

export interface ReadOnlyFinanceInventoryAdapter {
  listPage(entity: FinanceInventoryEntity, request: FinancePageRequest): Promise<FinancePage>;
}
