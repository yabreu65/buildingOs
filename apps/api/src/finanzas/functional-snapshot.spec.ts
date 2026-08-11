import {
  classifyFunctionalSnapshot,
  isFunctionalSnapshotPresent,
} from './functional-snapshot';

const fields = (overrides: Record<string, unknown> = {}) => ({
  functionalAmountMinor: null,
  functionalCurrencyCode: null,
  exchangeRateId: null,
  exchangeRateValue: null,
  exchangeRateDirection: null,
  exchangeRateEffectiveAt: null,
  conversionDate: null,
  ...overrides,
});

describe('classifyFunctionalSnapshot', () => {
  it('all null fields => LEGACY_NULL', () => {
    expect(classifyFunctionalSnapshot(fields())).toBe('LEGACY_NULL');
  });

  it('valid IDENTITY => COMPLETE', () => {
    expect(
      classifyFunctionalSnapshot(
        fields({
          functionalAmountMinor: 1000,
          functionalCurrencyCode: 'VES',
          exchangeRateValue: '1',
          exchangeRateDirection: 'IDENTITY',
          conversionDate: '2026-08-10',
        }),
      ),
    ).toBe('COMPLETE');
  });

  it('valid DIRECT => COMPLETE', () => {
    expect(
      classifyFunctionalSnapshot(
        fields({
          functionalAmountMinor: 36500,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-1',
          exchangeRateValue: '36.5',
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: '2026-08-08',
          conversionDate: '2026-08-10',
        }),
      ),
    ).toBe('COMPLETE');
  });

  it('valid INVERSE => COMPLETE', () => {
    expect(
      classifyFunctionalSnapshot(
        fields({
          functionalAmountMinor: 50000,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-2',
          exchangeRateValue: '50',
          exchangeRateDirection: 'INVERSE',
          exchangeRateEffectiveAt: '2026-08-08',
          conversionDate: '2026-08-10',
        }),
      ),
    ).toBe('COMPLETE');
  });

  it('IDENTITY with exchangeRateId => PARTIAL_INVALID', () => {
    expect(
      classifyFunctionalSnapshot(
        fields({
          functionalAmountMinor: 1000,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-1',
          exchangeRateValue: '1',
          exchangeRateDirection: 'IDENTITY',
          conversionDate: '2026-08-10',
        }),
      ),
    ).toBe('PARTIAL_INVALID');
  });

  it('DIRECT without exchangeRateId => PARTIAL_INVALID', () => {
    expect(
      classifyFunctionalSnapshot(
        fields({
          functionalAmountMinor: 36500,
          functionalCurrencyCode: 'VES',
          exchangeRateValue: '36.5',
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: '2026-08-08',
          conversionDate: '2026-08-10',
        }),
      ),
    ).toBe('PARTIAL_INVALID');
  });

  it('INVERSE without exchangeRateEffectiveAt => PARTIAL_INVALID', () => {
    expect(
      classifyFunctionalSnapshot(
        fields({
          functionalAmountMinor: 50000,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-2',
          exchangeRateValue: '50',
          exchangeRateDirection: 'INVERSE',
          conversionDate: '2026-08-10',
        }),
      ),
    ).toBe('PARTIAL_INVALID');
  });

  it('rate <= 0 => PARTIAL_INVALID', () => {
    expect(
      classifyFunctionalSnapshot(
        fields({
          functionalAmountMinor: 1000,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-1',
          exchangeRateValue: '0',
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: '2026-08-08',
          conversionDate: '2026-08-10',
        }),
      ),
    ).toBe('PARTIAL_INVALID');
  });

  it('isolated functional field => PARTIAL_INVALID', () => {
    expect(
      classifyFunctionalSnapshot(fields({ functionalAmountMinor: 1000 })),
    ).toBe('PARTIAL_INVALID');
    expect(
      classifyFunctionalSnapshot(fields({ conversionDate: '2026-08-10' })),
    ).toBe('PARTIAL_INVALID');
    expect(
      classifyFunctionalSnapshot(fields({ exchangeRateValue: '36.5' })),
    ).toBe('PARTIAL_INVALID');
  });

  it('functional currency without functional amount => PARTIAL_INVALID', () => {
    expect(
      classifyFunctionalSnapshot(fields({ functionalCurrencyCode: 'VES' })),
    ).toBe('PARTIAL_INVALID');
  });

  it('invalid direction => PARTIAL_INVALID', () => {
    expect(
      classifyFunctionalSnapshot(
        fields({
          functionalAmountMinor: 1000,
          functionalCurrencyCode: 'VES',
          exchangeRateValue: '1',
          exchangeRateDirection: 'HALF',
          conversionDate: '2026-08-10',
        }),
      ),
    ).toBe('PARTIAL_INVALID');
  });

  it('isFunctionalSnapshotPresent reflects any non-null field', () => {
    expect(isFunctionalSnapshotPresent(fields())).toBe(false);
    expect(isFunctionalSnapshotPresent(fields({ conversionDate: '2026-08-10' }))).toBe(true);
  });
});
