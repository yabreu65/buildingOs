import {
  formatAccountingPeriodLabel,
  getCurrentAccountingPeriod,
} from './period';

describe('dashboard period utils', () => {
  it('formats the current accounting period as YYYY-MM', () => {
    expect(getCurrentAccountingPeriod(new Date(2026, 5, 24, 12, 0, 0))).toBe('2026-06');
  });

  it('formats month labels in Spanish', () => {
    expect(formatAccountingPeriodLabel('2026-06')).toBe('Junio 2026');
    expect(formatAccountingPeriodLabel('2026-05')).toBe('Mayo 2026');
  });

  it('returns the original value for legacy periods', () => {
    expect(formatAccountingPeriodLabel('CURRENT_MONTH')).toBe('CURRENT_MONTH');
  });
});
