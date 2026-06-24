import { PeriodResolverService } from './period-resolver.service';
import type { CanonicalFinancePeriod } from './finance-period.types';

describe('PeriodResolverService', () => {
  let service: PeriodResolverService;
  const referenceDate = new Date(2026, 5, 24);

  beforeEach(() => {
    service = new PeriodResolverService();
  });

  function buildPeriod(overrides: Partial<CanonicalFinancePeriod> = {}): CanonicalFinancePeriod {
    return {
      kind: 'relative_range',
      amount: 5,
      unit: 'month',
      mode: 'unknown',
      month: null,
      year: null,
      startMonth: null,
      startYear: null,
      endMonth: null,
      endYear: null,
      ...overrides,
    };
  }

  it('resolves last 5 months including the current month', () => {
    const result = service.resolve(
      buildPeriod({ mode: 'including_current' }),
      referenceDate,
    );

    expect(result).toMatchObject({
      kind: 'period_range',
      periods: ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
      startPeriod: '2026-02',
      endPeriod: '2026-06',
      label: 'febrero 2026 a junio 2026',
    });
  });

  it('resolves last 5 closed months', () => {
    const result = service.resolve(
      buildPeriod({ mode: 'closed_months' }),
      referenceDate,
    );

    expect(result).toMatchObject({
      kind: 'period_range',
      periods: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'],
      startPeriod: '2026-01',
      endPeriod: '2026-05',
      label: 'enero 2026 a mayo 2026',
    });
  });

  it('resolves current month to a single period', () => {
    const result = service.resolve(
      {
        kind: 'current_month',
        amount: null,
        unit: null,
        mode: null,
        month: null,
        year: null,
        startMonth: null,
        startYear: null,
        endMonth: null,
        endYear: null,
      },
      referenceDate,
    );

    expect(result).toMatchObject({
      kind: 'single_period',
      periods: ['2026-06'],
      period: '2026-06',
      startPeriod: '2026-06',
      endPeriod: '2026-06',
      label: 'junio 2026',
    });
  });

  it('resolves previous month to a single period', () => {
    const result = service.resolve(
      {
        kind: 'previous_month',
        amount: null,
        unit: null,
        mode: null,
        month: null,
        year: null,
        startMonth: null,
        startYear: null,
        endMonth: null,
        endYear: null,
      },
      referenceDate,
    );

    expect(result).toMatchObject({
      kind: 'single_period',
      periods: ['2026-05'],
      period: '2026-05',
      startPeriod: '2026-05',
      endPeriod: '2026-05',
      label: 'mayo 2026',
    });
  });
});
