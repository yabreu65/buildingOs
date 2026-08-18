import { sameDateInput, toDateInputValue, todayLocalDate, toLocalDateString } from './date-input';

// Zona explícita (UTC-04) para validar el borde UTC->calendario local.
const previousTZ = process.env.TZ;
process.env.TZ = 'Etc/GMT+4';
afterAll(() => {
  process.env.TZ = previousTZ;
});

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
  it('uses local calendar components, not UTC, for a late-evening instant at UTC-04', () => {
    // 2026-08-18T02:30:00Z === 2026-08-17T22:30 local (Etc/GMT+4).
    const instant = new Date('2026-08-18T02:30:00.000Z');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-08-18'); // UTC day
    expect(toLocalDateString(instant)).toBe('2026-08-17'); // local calendar day
  });

  it('returns the local calendar date for "today" with fake timers', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-18T02:30:00.000Z'));
    expect(todayLocalDate()).toBe('2026-08-17');
    jest.useRealTimers();
  });

  it('zero-pads month and day', () => {
    expect(toLocalDateString(new Date('2026-08-05T12:00:00.000Z'))).toBe('2026-08-05');
  });
});
