import { sameDateInput, toDateInputValue, todayLocalDate, toLocalDateString } from './date-input';

describe('date input normalization (FIN-07BR3)', () => {
  it('normalizes an ISO receivedDate to YYYY-MM-DD', () => {
    expect(toDateInputValue('2026-08-10T00:00:00.000Z')).toBe('2026-08-10');
  });

  it('passes a plain date through as-is', () => {
    expect(toDateInputValue('2026-08-10')).toBe('2026-08-10');
  });

  it('handles empty values', () => {
    expect(toDateInputValue('')).toBe('');
  });

  it('treats ISO and plain date as the same day', () => {
    expect(sameDateInput('2026-08-10', '2026-08-10T00:00:00.000Z')).toBe(true);
    expect(sameDateInput('2026-08-11', '2026-08-10T00:00:00.000Z')).toBe(false);
  });
});

describe('local calendar date default (FIN-07BR3F)', () => {
  it('reads local calendar components instead of the UTC serialization', () => {
    // Instante UTC real. Sus getters de calendario local se simulan de forma
    // determinista (2026-08-17) para no depender de la timezone de la máquina.
    const instant = new Date('2026-08-18T02:30:00.000Z');
    const yearSpy = jest.spyOn(instant, 'getFullYear').mockReturnValue(2026);
    const monthSpy = jest.spyOn(instant, 'getMonth').mockReturnValue(7);
    const daySpy = jest.spyOn(instant, 'getDate').mockReturnValue(17);
    try {
      expect(instant.toISOString().slice(0, 10)).toBe('2026-08-18');
      expect(toLocalDateString(instant)).toBe('2026-08-17');
    } finally {
      yearSpy.mockRestore();
      monthSpy.mockRestore();
      daySpy.mockRestore();
    }
  });

  it('returns the local calendar date for "today" with frozen timers', () => {
    jest.useFakeTimers();
    try {
      const frozen = new Date('2026-08-18T02:30:00.000Z');
      jest.setSystemTime(frozen);
      expect(todayLocalDate()).toBe(toLocalDateString(new Date()));
    } finally {
      jest.useRealTimers();
    }
  });

  it('zero-pads month and day with controlled calendar components', () => {
    const date = new Date('2026-08-05T12:00:00.000Z');
    const yearSpy = jest.spyOn(date, 'getFullYear').mockReturnValue(2026);
    const monthSpy = jest.spyOn(date, 'getMonth').mockReturnValue(7);
    const daySpy = jest.spyOn(date, 'getDate').mockReturnValue(5);
    try {
      expect(toLocalDateString(date)).toBe('2026-08-05');
    } finally {
      yearSpy.mockRestore();
      monthSpy.mockRestore();
      daySpy.mockRestore();
    }
  });
});
