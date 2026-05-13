import { UnitCodeNormalizer } from './unit-code-normalizer';

describe('UnitCodeNormalizer', () => {
  it('normalizes preserving opaque code semantics', () => {
    const result = UnitCodeNormalizer.normalize(' a-0123 ');
    expect(result.raw).toBe('a-0123');
    expect(result.normalized).toBe('A-0123');
    expect(result.candidates).toEqual(expect.arrayContaining(['A-0123']));
  });

  it('normalizes unicode dashes', () => {
    const result = UnitCodeNormalizer.normalize('A–0123');
    expect(result.normalized).toBe('A-0123');
  });

  it('generates space/hyphen/compact candidates', () => {
    const result = UnitCodeNormalizer.normalize('A 0123');
    expect(result.candidates).toEqual(expect.arrayContaining(['A 0123', 'A-0123', 'A0123']));
  });

  it('generates compact and hyphen variants for A0123', () => {
    const result = UnitCodeNormalizer.normalize('A0123');
    expect(result.candidates).toEqual(expect.arrayContaining(['A0123', 'A-0123', '0123']));
  });

  it('adds numeric fallback candidate for prefixed codes', () => {
    const result = UnitCodeNormalizer.normalize('A-0123');
    expect(result.candidates).toEqual(expect.arrayContaining(['0123']));
  });
});
