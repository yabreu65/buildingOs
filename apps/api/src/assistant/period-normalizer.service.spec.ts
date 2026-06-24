import { PeriodNormalizerService } from './period-normalizer.service';

describe('PeriodNormalizerService', () => {
  let service: PeriodNormalizerService;

  beforeEach(() => {
    service = new PeriodNormalizerService();
  });

  it.each([
    ['este mes', 'current_month'],
    ['mes actual', 'current_month'],
    ['mes en curso', 'current_month'],
    ['mes corriente', 'current_month'],
  ])('normalizes "%s" as %s', (phrase, kind) => {
    expect(service.normalize(phrase)?.kind).toBe(kind);
  });

  it.each([
    ['mes pasado', 'previous_month'],
    ['último mes', 'previous_month'],
  ])('normalizes "%s" as previous_month', (phrase) => {
    expect(service.normalize(phrase)?.kind).toBe('previous_month');
  });

  it.each([
    ['acumulada', 'accumulated'],
    ['histórica', 'accumulated'],
    ['historica', 'accumulated'],
    ['toda', 'accumulated'],
    ['todo', 'accumulated'],
  ])('normalizes "%s" as accumulated', (phrase) => {
    expect(service.normalize(phrase)?.kind).toBe('accumulated');
  });

  it('normalizes a named month with explicit year', () => {
    const result = service.normalize('junio 2026');
    expect(result).toMatchObject({
      kind: 'named_month',
      month: 6,
      year: 2026,
    });
  });

  it('normalizes an ISO month', () => {
    const result = service.normalize('2026-06');
    expect(result).toMatchObject({
      kind: 'named_month',
      month: 6,
      year: 2026,
    });
  });

  it.each([
    'últimos 5 meses',
    'ultimos 5 meses',
    'los ultimos 5 meses',
    'últimos cinco meses',
  ])('normalizes "%s" as a relative range', (phrase) => {
    expect(service.normalize(phrase)).toMatchObject({
      kind: 'relative_range',
      amount: 5,
      unit: 'month',
      mode: 'unknown',
    });
  });

  it('detects relative range including the current month', () => {
    expect(service.normalize('últimos 5 meses incluyendo este mes')).toMatchObject({
      kind: 'relative_range',
      amount: 5,
      unit: 'month',
      mode: 'including_current',
    });
  });

  it('detects relative range closed months', () => {
    expect(service.normalize('últimos 5 meses cerrados')).toMatchObject({
      kind: 'relative_range',
      amount: 5,
      unit: 'month',
      mode: 'closed_months',
    });
  });

  it('clamps the relative range amount to a sane minimum and maximum', () => {
    expect(service.normalize('últimos 0 meses')).toMatchObject({
      kind: 'relative_range',
      amount: 1,
    });
    expect(service.normalize('últimos 99 meses')).toMatchObject({
      kind: 'relative_range',
      amount: 12,
    });
  });
});
