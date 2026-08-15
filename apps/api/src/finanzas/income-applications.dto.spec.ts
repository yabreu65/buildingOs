import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IncomeApplicationDestination } from '@prisma/client';
import {
  CreateIncomeApplicationsDto,
  MAX_APPLICATIONS_PER_PLAN,
} from './income-applications.dto';

const validate = (input: Record<string, unknown>) =>
  validateSync(plainToInstance(CreateIncomeApplicationsDto, input), {
    whitelist: true,
    forbidUnknownValues: true,
  });

const makeApp = (overrides: Record<string, unknown> = {}) => ({
  destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
  amountMinor: 10000,
  ...overrides,
});

describe('CreateIncomeApplicationsDto (FIN-03R BLOCKER C)', () => {
  it('accepts 1 valid application', () => {
    expect(validate({ applications: [makeApp()] })).toHaveLength(0);
  });

  it('accepts 2 valid applications', () => {
    expect(
      validate({
        applications: [
          makeApp({ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 }),
          makeApp({ destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000 }),
        ],
      }),
    ).toHaveLength(0);
  });

  it('accepts up to MAX_APPLICATIONS_PER_PLAN items (boundary)', () => {
    const many = Array.from({ length: MAX_APPLICATIONS_PER_PLAN }, (_, i) =>
      makeApp({ destinationType: IncomeApplicationDestination.FUND, fundId: `fund-${i}`, amountMinor: 1 }),
    );
    expect(validate({ applications: many })).toHaveLength(0);
  });

  it('rejects more than MAX_APPLICATIONS_PER_PLAN items', () => {
    const tooMany = Array.from({ length: MAX_APPLICATIONS_PER_PLAN + 1 }, (_, i) =>
      makeApp({ destinationType: IncomeApplicationDestination.FUND, fundId: `fund-${i}`, amountMinor: 1 }),
    );
    const errors = validate({ applications: tooMany });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'applications')).toBe(true);
  });

  it('rejects amountMinor = 0 (nested validation)', () => {
    const errors = validate({ applications: [makeApp({ amountMinor: 0 })] });
    expect(errors.some((e) => e.property === 'applications')).toBe(true);
  });

  it('rejects an invalid destinationType enum', () => {
    const errors = validate({ applications: [makeApp({ destinationType: 'NOT_A_DESTINATION' })] });
    expect(errors.some((e) => e.property === 'applications')).toBe(true);
  });

  it('rejects an empty array', () => {
    const errors = validate({ applications: [] });
    expect(errors.some((e) => e.property === 'applications')).toBe(true);
  });

  it('rejects missing applications', () => {
    const errors = validate({});
    expect(errors.some((e) => e.property === 'applications')).toBe(true);
  });
});
