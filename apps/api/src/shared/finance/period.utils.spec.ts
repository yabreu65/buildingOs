import {
  formatPeriod,
  shiftPeriod,
  getLastCompletePeriods,
  getPeriodDateRange,
} from './period.utils';

describe('period.utils', () => {
  it('formats period as YYYY-MM', () => {
    expect(formatPeriod(new Date('2026-04-19T12:00:00.000Z'))).toBe('2026-04');
  });

  it('shifts period across year boundaries', () => {
    expect(shiftPeriod('2026-04', -3)).toBe('2026-01');
    expect(shiftPeriod('2026-11', 2)).toBe('2027-01');
  });

  it('returns last 3 complete periods excluding current', () => {
    const periods = getLastCompletePeriods(
      new Date('2026-04-19T12:00:00.000Z'),
      3,
      true,
    );
    expect(periods).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('returns period date range with full month bounds', () => {
    const range = getPeriodDateRange('2026-03');
    expect(range.startDate.getFullYear()).toBe(2026);
    expect(range.startDate.getMonth()).toBe(2);
    expect(range.startDate.getDate()).toBe(1);
    expect(range.startDate.getHours()).toBe(0);
    expect(range.startDate.getMinutes()).toBe(0);

    expect(range.endDate.getFullYear()).toBe(2026);
    expect(range.endDate.getMonth()).toBe(2);
    expect(range.endDate.getDate()).toBe(31);
    expect(range.endDate.getHours()).toBe(23);
    expect(range.endDate.getMinutes()).toBe(59);
    expect(range.endDate.getSeconds()).toBe(59);
    expect(range.endDate.getMilliseconds()).toBe(999);
  });
});
