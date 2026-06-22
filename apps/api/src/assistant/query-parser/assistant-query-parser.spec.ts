import { AssistantQueryParser, BUILDING_SYNONYMS, UNIT_SYNONYMS } from './assistant-query-parser';

describe('AssistantQueryParser', () => {
  let parser: AssistantQueryParser;

  beforeEach(() => {
    parser = new AssistantQueryParser();
  });

  describe('extractUnitToken', () => {
    it.each([
      ['que debe la unidad 0213', '0213'],
      ['depto 5B', '5B'],
      ['apartamento 12-A', '12-A'],
      ['el apto 301', '301'],
      ['local comercial L-01', 'L-01'],
      ['oficina 402', '402'],
      ['casa 15', '15'],
      ['cochera C-03', 'C-03'],
    ])('should extract "%s" from "%s"', (message, expected) => {
      expect(parser.extractUnitToken(message)).toBe(expected);
    });

    it('should return null for messages without unit', () => {
      expect(parser.extractUnitToken('hola mundo')).toBeNull();
    });

    it('should handle case insensitivity', () => {
      expect(parser.extractUnitToken('UNIDAD 0213')).toBe('0213');
      expect(parser.extractUnitToken('DEPTO 5B')).toBe('5B');
    });
  });

  describe('extractBuildingToken', () => {
    it.each([
      ['torre A', 'A'],
      ['edificio B', 'B'],
      ['condominio H', 'H'],
      ['bloque C', 'C'],
      ['tower D', 'D'],
      ['building E', 'E'],
      ['sector 1', '1'],
      ['residencia San Cristobal', 'San'],
      ['conjunto F', 'F'],
    ])('should extract "%s" from "%s"', (message, expected) => {
      expect(parser.extractBuildingToken(message)).toBe(expected);
    });

    it('should return null for messages without building', () => {
      expect(parser.extractBuildingToken('hola mundo')).toBeNull();
    });

    it('should handle spanish accents', () => {
      expect(parser.extractBuildingToken('pabellón G')).toBe('G');
    });
  });

  describe('findBuilding', () => {
    const buildings = [
      { id: '1', name: 'Edificio A' },
      { id: '2', name: 'Edificio B' },
      { id: '3', name: 'Torre C' },
      { id: '4', name: 'Residencia San Cristobal' },
    ];

    it('should match exact name', () => {
      const result = parser.findBuilding(buildings, 'Edificio A');
      expect(result.matched).toBe(true);
      expect(result.item?.name).toBe('Edificio A');
      expect(result.reason).toBe('exact');
    });

    it('should match by token "A" when unique', () => {
      const result = parser.findBuilding(buildings, 'A');
      expect(result.matched).toBe(true);
      expect(result.item?.name).toBe('Edificio A');
    });

    it('should match by partial name', () => {
      const result = parser.findBuilding(buildings, 'Cristobal');
      expect(result.matched).toBe(true);
      expect(result.item?.name).toBe('Residencia San Cristobal');
    });

    it('should return alternatives when ambiguous', () => {
      const result = parser.findBuilding(buildings, 'Edificio');
      expect(result.matched).toBe(false);
      expect(result.alternatives.length).toBe(2);
    });

    it('should match case-insensitively', () => {
      const result = parser.findBuilding(buildings, 'edificio a');
      expect(result.matched).toBe(true);
    });

    it('should handle spanish accents', () => {
      const result = parser.findBuilding(buildings, 'cristóbal');
      expect(result.matched).toBe(true);
    });

    it('should return none for unknown token', () => {
      const result = parser.findBuilding(buildings, 'Z');
      expect(result.matched).toBe(false);
      expect(result.reason).toBe('none');
    });
  });

  describe('findUnit', () => {
    const units = [
      { id: '1', code: '0213', label: 'Unidad 0213' },
      { id: '2', code: 'A-101', label: 'Departamento A-101' },
      { id: '3', code: '213', label: null },
      { id: '4', code: '5B', label: 'Depto 5B' },
    ];

    it('should match exact code', () => {
      const result = parser.findUnit(units, '0213');
      expect(result.matched).toBe(true);
      expect(result.item?.code).toBe('0213');
    });

    it('should match exact label', () => {
      const result = parser.findUnit(units, 'Depto 5B');
      expect(result.matched).toBe(true);
      expect(result.item?.code).toBe('5B');
    });

    it('should match floor-dept pattern', () => {
      const result = parser.findUnit(units, '2-13');
      expect(result.matched).toBe(true);
      expect(result.item?.code).toBe('213');
    });

    it('should match compact code', () => {
      const result = parser.findUnit(units, 'A101');
      expect(result.matched).toBe(true);
      expect(result.item?.code).toBe('A-101');
    });

    it('should return alternatives when ambiguous', () => {
      const ambiguousUnits = [
        { id: '1', code: '0213', label: 'Unidad 0213' },
        { id: '2', code: '2-13', label: null },
      ];
      const result = parser.findUnit(ambiguousUnits, '213');
      expect(result.matched).toBe(false);
      expect(result.alternatives.length).toBe(2);
    });

    it('should return none for unknown unit', () => {
      const result = parser.findUnit(units, '9999');
      expect(result.matched).toBe(false);
      expect(result.reason).toBe('none');
    });
  });

  describe('normalize', () => {
    it('should lowercase', () => {
      expect(parser.normalize('HELLO')).toBe('hello');
    });

    it('should remove accents', () => {
      expect(parser.normalize('cristóbal')).toBe('cristobal');
      expect(parser.normalize('pabellón')).toBe('pabellon');
    });

    it('should trim', () => {
      expect(parser.normalize('  hello  ')).toBe('hello');
    });
  });

  describe('parseUnitReference', () => {
    it.each([
      ['A-0101', { unitCode: 'A-0101' }],
      ['B-0101', { unitCode: 'B-0101' }],
      ['C-0201', { unitCode: 'C-0201' }],
      ['A0101', { unitCode: 'A0101' }],
      ['B0101', { unitCode: 'B0101' }],
      ['A1-123', { unitCode: 'A1-123' }],
      ['B2-045', { unitCode: 'B2-045' }],
    ])('should parse alias-code "%s"', (message, expected) => {
      expect(parser.parseUnitReference(message)).toEqual(expect.objectContaining(expected));
    });

    it.each([
      ['departamento 0101 de la A', { unitCode: '0101' }],
      ['depto 0101 del edificio B', { buildingAlias: 'B', unitCode: '0101' }],
      ['unidad 0201 en Torre C', { buildingAlias: 'C', unitCode: '0201' }],
    ])('should parse reverse pattern "%s"', (message, expected) => {
      expect(parser.parseUnitReference(message)).toEqual(expect.objectContaining(expected));
    });

    it.each([
      ['quien vive en 0101', { unitCode: '0101' }],
      ['departamento 0101', { unitCode: '0101' }],
      ['unidad 0101', { unitCode: '0101' }],
    ])('should parse code-only "%s"', (message, expected) => {
      expect(parser.parseUnitReference(message)).toEqual(expect.objectContaining(expected));
    });

    it.each([
      ['deuda de 1-01', { unitCode: '1-01' }],
      ['pagos de 12-01', { unitCode: '12-01' }],
      ['deuda unidad 2-B', { unitCode: '2-B' }],
      ['deuda depto PB-01', { unitCode: 'PB-01' }],
    ])('should parse floor-dept pattern "%s"', (message, expected) => {
      expect(parser.parseUnitReference(message)).toEqual(expect.objectContaining(expected));
    });

    it('should not infer building alias from unit code token', () => {
      const result = parser.parseUnitReference('deuda de la unidad A-0123');
      expect(result).toEqual(expect.objectContaining({ unitCode: 'A-0123' }));
      expect(result?.buildingAlias).toBeUndefined();
    });

    it('should extract explicit building alias only when building is explicitly mentioned', () => {
      const result = parser.parseUnitReference('deuda de la unidad 0123 en Torre A');
      expect(result).toEqual(expect.objectContaining({
        unitCode: '0123',
        buildingAlias: 'A',
      }));
    });

    it('should keep code as opaque for "cuanto debe A-0123"', () => {
      const result = parser.parseUnitReference('cuánto debe A-0123');
      expect(result).toEqual(expect.objectContaining({ unitCode: 'A-0123' }));
      expect(result?.buildingAlias).toBeUndefined();
    });

    it('should keep code as opaque for "deuda unidad 2-B"', () => {
      const result = parser.parseUnitReference('deuda unidad 2-B');
      expect(result).toEqual(expect.objectContaining({ unitCode: '2-B' }));
      expect(result?.buildingAlias).toBeUndefined();
    });

    it('should return null for messages without unit reference', () => {
      expect(parser.parseUnitReference('hola mundo')).toBeNull();
    });

    it('should return null for invalid patterns', () => {
      expect(parser.parseUnitReference('edificio A')).toBeNull();
      expect(parser.parseUnitReference('torre B')).toBeNull();
    });
  });

  describe('synonym coverage', () => {
    it('BUILDING_SYNONYMS should cover common terms', () => {
      expect(BUILDING_SYNONYMS).toContain('torre');
      expect(BUILDING_SYNONYMS).toContain('edificio');
      expect(BUILDING_SYNONYMS).toContain('bloque');
      expect(BUILDING_SYNONYMS).toContain('residencia');
    });

    it('UNIT_SYNONYMS should cover common terms', () => {
      expect(UNIT_SYNONYMS).toContain('unidad');
      expect(UNIT_SYNONYMS).toContain('depto');
      expect(UNIT_SYNONYMS).toContain('apartamento');
      expect(UNIT_SYNONYMS).toContain('cochera');
    });
  });
});
