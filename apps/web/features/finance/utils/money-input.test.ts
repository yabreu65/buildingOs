import {
  decimalToAmountMinor,
  minorToDecimalString,
  percentageToBasisPoints,
  sumAmountMinor,
} from './money-input';

describe('money input helpers', () => {
  describe('decimalToAmountMinor', () => {
    it.each([
      ['12', 1200],
      ['12.3', 1230],
      ['12.34', 1234],
      [' 0.01 ', 1],
    ])('converts %s to its exact minor-unit amount', (value, expected) => {
      expect(decimalToAmountMinor(value)).toBe(expected);
    });

    it.each(['', '0', '12.345', '-1', '.50', '1,25', 'abc'])('rejects invalid monetary input %s', (value) => {
      expect(decimalToAmountMinor(value)).toBeNull();
    });
  });

  describe('percentageToBasisPoints', () => {
    it.each([
      ['100', 10000],
      ['33.33', 3333],
      ['0.01', 1],
    ])('converts %s%% to basis points', (value, expected) => {
      expect(percentageToBasisPoints(value)).toBe(expected);
    });

    it.each(['0', '100.01', '1.234', '-1', ''])('rejects invalid percentages %s', (value) => {
      expect(percentageToBasisPoints(value)).toBeNull();
    });
  });

  it('adds minor-unit values without floating-point arithmetic', () => {
    expect(sumAmountMinor([3333, 3333, 3334])).toBe(10000);
    expect(sumAmountMinor([1, -1])).toBeNull();
  });
});

describe('minorToDecimalString (FIN-07BR3F)', () => {
  it.each([
    [10000, '100.00'],
    [12345, '123.45'],
    [1, '0.01'],
    [5, '0.05'],
    [0, '0.00'],
    [100000, '1000.00'],
  ])('formats %i minor units as %s', (minor, expected) => {
    expect(minorToDecimalString(minor)).toBe(expected);
  });

  it('handles a safe-integer boundary without drift', () => {
    const big = Number.MAX_SAFE_INTEGER - (Number.MAX_SAFE_INTEGER % 100);
    expect(minorToDecimalString(big)).toBe(`${Math.floor(big / 100)}.00`);
  });

  it('rejects unsafe or negative input', () => {
    expect(minorToDecimalString(-1)).toBe('');
    expect(minorToDecimalString(1.5)).toBe('');
  });
});
