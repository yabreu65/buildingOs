import { aliasFromIndex } from './alias-generator';

describe('aliasFromIndex', () => {
  it.each([
    [1, 'A'],
    [2, 'B'],
    [3, 'C'],
    [25, 'Y'],
    [26, 'Z'],
    [27, 'AA'],
    [28, 'AB'],
    [29, 'AC'],
    [51, 'AY'],
    [52, 'AZ'],
    [53, 'BA'],
    [54, 'BB'],
    [676, 'YZ'],
    [677, 'ZA'],
    [701, 'ZY'],
    [702, 'ZZ'],
    [703, 'AAA'],
    [704, 'AAB'],
  ])('should convert %d to "%s"', (index, expected) => {
    expect(aliasFromIndex(index)).toBe(expected);
  });

  it('should throw for index 0', () => {
    expect(() => aliasFromIndex(0)).toThrow('Index must be greater than 0');
  });

  it('should throw for negative index', () => {
    expect(() => aliasFromIndex(-1)).toThrow('Index must be greater than 0');
  });

  it('should be deterministic', () => {
    expect(aliasFromIndex(1)).toBe(aliasFromIndex(1));
    expect(aliasFromIndex(27)).toBe(aliasFromIndex(27));
  });

  it('should never return empty string for positive index', () => {
    expect(aliasFromIndex(1)).not.toBe('');
    expect(aliasFromIndex(1000)).not.toBe('');
  });
});
