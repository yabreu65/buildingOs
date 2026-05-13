import { FilterCoverageValidator } from './filter-coverage.validator';

describe('FilterCoverageValidator', () => {
  let validator: FilterCoverageValidator;

  beforeEach(() => {
    validator = new FilterCoverageValidator();
  });

  it('marks extraction incomplete when period/method are mentioned but missing', () => {
    const result = validator.analyze('Pagos de enero por transferencia', {});

    expect(result.complete).toBe(false);
    expect(result.missingFields).toEqual(
      expect.arrayContaining(['period', 'method']),
    );
  });

  it('marks extraction complete when period/method are covered', () => {
    const result = validator.analyze('Pagos de enero por transferencia', {
      period: '2026-01',
      method: 'TRANSFER',
    });

    expect(result.complete).toBe(true);
    expect(result.missingFields).toHaveLength(0);
  });

  it('detects amount comparisons and requires numeric filters', () => {
    const result = validator.analyze('Hay deuda mayor a 500', {});

    expect(result.complete).toBe(false);
    expect(result.missingFields).toContain('minAmount_or_maxAmount_or_minDebt');
  });
});
