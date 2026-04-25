import type { DebtAgingRow, DebtByPeriodRow } from '../services/dashboard.api';

export interface MorosidadFilterState {
  only90Plus: boolean;
  minimumDebtArs: string;
  withoutResponsible: boolean;
  search: string;
  asOf: string;
}

export interface MorosidadFilterChip {
  key: 'only90' | 'minDebt' | 'noOwner' | 'search';
  label: string;
}

/**
 * Build filter chips for Morosidad table.
 */
export function buildMorosidadFilterChips(filters: MorosidadFilterState): MorosidadFilterChip[] {
  const chips: MorosidadFilterChip[] = [];

  if (filters.only90Plus) {
    chips.push({ key: 'only90', label: '90+ días' });
  }

  const minimumDebtCents = parseMinimumDebtToCents(filters.minimumDebtArs);
  if (minimumDebtCents !== null) {
    chips.push({
      key: 'minDebt',
      label: `Deuda mínima: $${new Intl.NumberFormat('es-AR', {
        maximumFractionDigits: 0,
      }).format(Number(filters.minimumDebtArs))}`,
    });
  }

  if (filters.withoutResponsible) {
    chips.push({ key: 'noOwner', label: 'Sin responsable' });
  }

  const normalizedSearch = filters.search.trim();
  if (normalizedSearch.length > 0) {
    chips.push({ key: 'search', label: `Búsqueda: ${normalizedSearch}` });
  }

  return chips;
}

/**
 * Apply local filters to debt aging rows.
 */
export function filterMorosidadRows(
  rows: DebtAgingRow[],
  filters: MorosidadFilterState,
): DebtAgingRow[] {
  const minimumDebtCents = parseMinimumDebtToCents(filters.minimumDebtArs);
  const normalizedSearch = filters.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.only90Plus && !isRowNinetyPlusOrMore(row, filters.asOf)) {
      return false;
    }

    if (minimumDebtCents !== null && row.overdueTotal < minimumDebtCents) {
      return false;
    }

    if (filters.withoutResponsible && row.responsable) {
      return false;
    }

    if (normalizedSearch.length > 0) {
      const responsibleName = row.responsable?.name?.toLowerCase() || '';
      const haystack = `${row.unitLabel.toLowerCase()} ${responsibleName}`;
      if (!haystack.includes(normalizedSearch)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Apply local filters to debt-by-period rows.
 */
export function filterMorosidadByPeriodRows(
  rows: DebtByPeriodRow[],
  filters: Omit<MorosidadFilterState, 'only90Plus' | 'asOf'>,
): DebtByPeriodRow[] {
  const minimumDebtCents = parseMinimumDebtToCents(filters.minimumDebtArs);
  const normalizedSearch = filters.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (minimumDebtCents !== null && row.totalOverdue < minimumDebtCents) {
      return false;
    }

    if (filters.withoutResponsible && row.responsable) {
      return false;
    }

    if (normalizedSearch.length > 0) {
      const responsibleName = row.responsable?.name?.toLowerCase() || '';
      const haystack = `${row.unitLabel.toLowerCase()} ${responsibleName}`;
      if (!haystack.includes(normalizedSearch)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Parse minimum debt (ARS) to cents. Empty means no filter.
 */
export function parseMinimumDebtToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
}

/**
 * Resolve 90+ logic using bucket first, then due date fallback.
 */
export function isRowNinetyPlusOrMore(row: DebtAgingRow, asOf: string): boolean {
  if (row.bucket === '90_plus') {
    return true;
  }

  const dueDate = normalizeToIsoDate(row.oldestUnpaidDueDate);
  const asOfDate = normalizeToIsoDate(asOf);

  if (!dueDate || !asOfDate) {
    return false;
  }

  return diffDays(asOfDate, dueDate) > 90;
}

function normalizeToIsoDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch?.[1]) {
    return isoMatch[1];
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function diffDays(asOf: string, dueDate: string): number {
  const [asOfYear, asOfMonth, asOfDay] = asOf.split('-').map(Number);
  const [dueYear, dueMonth, dueDay] = dueDate.split('-').map(Number);

  const asOfUtc = Date.UTC(asOfYear, asOfMonth - 1, asOfDay);
  const dueUtc = Date.UTC(dueYear, dueMonth - 1, dueDay);
  return Math.floor((asOfUtc - dueUtc) / 86_400_000);
}
