import {
  buildMorosidadFilterChips,
  filterMorosidadByPeriodRows,
  filterMorosidadRows,
  isRowNinetyPlusOrMore,
  parseMinimumDebtToCents,
} from './morosidad-filters';
import type { DebtAgingRow, DebtByPeriodRow } from '../services/dashboard.api';

const baseRow: DebtAgingRow = {
  unitId: 'unit-1',
  buildingId: 'building-1',
  unitLabel: 'Torre Norte • 302',
  responsable: {
    memberId: 'member-1',
    name: 'Ana Gómez',
    role: 'OWNER',
  },
  overdueTotal: 550_000,
  bucket: '31_60',
  oldestUnpaidDueDate: '2026-03-01',
  oldestUnpaidPeriod: '2026-03',
  lastPaymentDate: null,
};

describe('morosidad filters', () => {
  it('parses minimum debt as cents and keeps empty as null', () => {
    expect(parseMinimumDebtToCents('')).toBeNull();
    expect(parseMinimumDebtToCents('5000')).toBe(500_000);
  });

  it('uses bucket 90_plus directly', () => {
    const row = { ...baseRow, bucket: '90_plus' as const };
    expect(isRowNinetyPlusOrMore(row, '2026-04-19')).toBe(true);
  });

  it('falls back to oldestUnpaidDueDate for 90+ filter', () => {
    const row = { ...baseRow, bucket: '31_60' as const, oldestUnpaidDueDate: '2025-12-01' };
    expect(isRowNinetyPlusOrMore(row, '2026-04-19')).toBe(true);
  });

  it('filters by minimum debt, responsible and search', () => {
    const rows: DebtAgingRow[] = [
      baseRow,
      {
        ...baseRow,
        unitId: 'unit-2',
        unitLabel: 'Torre Sur • 101',
        overdueTotal: 120_000,
        responsable: null,
      },
    ];

    const filtered = filterMorosidadRows(rows, {
      only90Plus: false,
      minimumDebtArs: '1000',
      withoutResponsible: true,
      search: 'sur',
      asOf: '2026-04-19',
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.unitId).toBe('unit-2');
  });

  it('builds chips only for active filters', () => {
    const chips = buildMorosidadFilterChips({
      only90Plus: true,
      minimumDebtArs: '5000',
      withoutResponsible: false,
      search: '302',
      asOf: '2026-04-19',
    });

    expect(chips.map((chip) => chip.label)).toEqual(
      expect.arrayContaining(['90+ días', 'Búsqueda: 302']),
    );
    expect(chips.find((chip) => chip.key === 'minDebt')).toBeDefined();
  });

  it('filters by-period rows using minimum debt, responsible and search', () => {
    const rows: DebtByPeriodRow[] = [
      {
        unitId: 'unit-1',
        buildingId: 'building-1',
        unitLabel: 'Torre Norte • 302',
        responsable: {
          memberId: 'member-1',
          name: 'Ana Gómez',
          role: 'OWNER',
        },
        totalOverdue: 300_000,
        periods: [],
        oldestUnpaidPeriod: '2026-03',
        oldestUnpaidDueDate: '2026-03-01',
        lastPaymentDate: null,
      },
      {
        unitId: 'unit-2',
        buildingId: 'building-1',
        unitLabel: 'Torre Sur • 101',
        responsable: null,
        totalOverdue: 700_000,
        periods: [],
        oldestUnpaidPeriod: '2026-02',
        oldestUnpaidDueDate: '2026-02-10',
        lastPaymentDate: null,
      },
    ];

    const filtered = filterMorosidadByPeriodRows(rows, {
      minimumDebtArs: '5000',
      withoutResponsible: true,
      search: 'sur',
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.unitId).toBe('unit-2');
  });
});
