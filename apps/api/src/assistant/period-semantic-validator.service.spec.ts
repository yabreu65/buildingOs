import { PeriodSemanticValidatorService } from './period-semantic-validator.service';
import type { CanonicalFinancePeriod } from './finance-period.types';

describe('PeriodSemanticValidatorService', () => {
  let service: PeriodSemanticValidatorService;

  beforeEach(() => {
    service = new PeriodSemanticValidatorService();
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

  it('asks for period.mode when relative range mode is unknown', () => {
    const result = service.validate({ period: buildPeriod() });

    expect(result).toEqual({
      valid: false,
      requiresClarification: true,
      missingFields: ['period.mode'],
      clarificationMessage: '¿Querés incluir el mes actual o consultar solo los últimos 5 meses cerrados?',
      normalizedPeriod: buildPeriod(),
    });
  });

  it('accepts relative range including the current month', () => {
    const result = service.validate({
      period: buildPeriod({ mode: 'including_current' }),
    });

    expect(result.valid).toBe(true);
    expect(result.requiresClarification).toBe(false);
    expect(result.missingFields).toEqual([]);
  });

  it('accepts relative range closed months', () => {
    const result = service.validate({
      period: buildPeriod({ mode: 'closed_months' }),
    });

    expect(result.valid).toBe(true);
    expect(result.requiresClarification).toBe(false);
    expect(result.missingFields).toEqual([]);
  });

  it('normalizes startMonth and endMonth model errors to period.mode', () => {
    const result = service.validate({
      period: buildPeriod(),
      missingFields: ['startMonth', 'endMonth'],
    });

    expect(result.valid).toBe(false);
    expect(result.requiresClarification).toBe(true);
    expect(result.missingFields).toEqual(['period.mode']);
  });
});
