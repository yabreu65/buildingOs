import { AssistantQueryParser } from './query-parser/assistant-query-parser';

describe('E2E: Alias Resolution Pipeline', () => {
  let parser: AssistantQueryParser;

  beforeEach(() => {
    parser = new AssistantQueryParser();
  });

  describe('parseUnitReference E2E', () => {
    it('should parse "A-0101" as opaque code', () => {
      const result = parser.parseUnitReference('Quién vive en A-0101');
      expect(result).toEqual(expect.objectContaining({ unitCode: 'A-0101' }));
      expect(result?.buildingAlias).toBeUndefined();
    });

    it('should parse "B0101" compact as opaque code', () => {
      const result = parser.parseUnitReference('Deuda de B0101');
      expect(result).toEqual(expect.objectContaining({ unitCode: 'B0101' }));
      expect(result?.buildingAlias).toBeUndefined();
    });

    it('should parse "0101" solo → code 0101 only', () => {
      const result = parser.parseUnitReference('Quién vive en la unidad 0101');
      expect(result).toEqual(expect.objectContaining({ unitCode: '0101' }));
    });

    it('should not infer building from "0101 de la A" without explicit synonym', () => {
      const result = parser.parseUnitReference('Residente de 0101 de la A');
      expect(result).toEqual(expect.objectContaining({ unitCode: '0101' }));
      expect(result?.buildingAlias).toBeUndefined();
    });

    it('should parse "unidad 0101 del edificio B" → alias B, code 0101', () => {
      const result = parser.parseUnitReference('Documentos de la unidad 0101 del edificio B');
      expect(result).toEqual(expect.objectContaining({ buildingAlias: 'B', unitCode: '0101' }));
    });

    it('should parse "C-0201" as opaque code', () => {
      const result = parser.parseUnitReference('Tickets de C-0201');
      expect(result).toEqual(expect.objectContaining({ unitCode: 'C-0201' }));
      expect(result?.buildingAlias).toBeUndefined();
    });

    it('should parse "A1-123" as opaque code', () => {
      const result = parser.parseUnitReference('Deuda de la unidad A1-123');
      expect(result).toEqual(expect.objectContaining({ unitCode: 'A1-123' }));
      expect(result?.buildingAlias).toBeUndefined();
    });

    it('should parse "depto 0101" → code 0101', () => {
      const result = parser.parseUnitReference('Quién vive en el depto 0101');
      expect(result).toEqual(expect.objectContaining({ unitCode: '0101' }));
    });

    it('should parse floor-dept "12-01" as opaque code', () => {
      const result = parser.parseUnitReference('Pagos de 12-01');
      expect(result).toEqual(expect.objectContaining({ unitCode: '12-01' }));
    });

    it('should parse "1-01" as opaque code', () => {
      const result = parser.parseUnitReference('Deuda de 1-01');
      expect(result).toEqual(expect.objectContaining({ unitCode: '1-01' }));
    });

    it('should return null for text without unit reference', () => {
      const result = parser.parseUnitReference('Hola mundo');
      expect(result).toBeNull();
    });

    it('should return null for building-only text', () => {
      const result = parser.parseUnitReference('Edificio A');
      expect(result).toBeNull();
    });
  });

  describe('aliasFromIndex E2E', () => {
    it('should generate correct aliases for sequence', () => {
      const { aliasFromIndex } = require('../shared/utils/alias-generator');
      
      const aliases = [];
      for (let i = 1; i <= 30; i++) {
        aliases.push(aliasFromIndex(i));
      }
      
      expect(aliases).toEqual([
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
        'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
        'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD'
      ]);
    });
  });

  describe('UnitResolverService E2E (with mocks)', () => {
    it('should resolve displayCode as "A-0101"', async () => {
      const { AssistantUnitResolverService } = require('./unit-resolver/assistant-unit-resolver.service');
      
      const mockPrisma = {
        building: {
          findFirst: jest.fn().mockResolvedValue({ id: 'b1', name: 'Torre A', alias: 'A' }),
        },
        unit: {
          findFirst: jest.fn().mockResolvedValue({ id: 'u1', code: '0101', label: null, unitType: 'APARTAMENTO' }),
          findMany: jest.fn(),
        },
        unitAssociation: { findFirst: jest.fn() },
      };
      
      const resolver = new AssistantUnitResolverService(mockPrisma);
      const result = await resolver.resolve('tenant-1', { unitCode: '0101', buildingAlias: 'A' });
      
      expect(result.errorResponse).toBeNull();
      expect(result.resolved.displayCode).toBe('A-0101');
      expect(result.resolved.building.alias).toBe('A');
      expect(result.resolved.unit.code).toBe('0101');
    });

    it('should return ambiguity error for duplicate unit code across buildings', async () => {
      const { AssistantUnitResolverService } = require('./unit-resolver/assistant-unit-resolver.service');
      
      const mockPrisma = {
        building: { findFirst: jest.fn(), findMany: jest.fn() },
        unit: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'u1', code: 'A-0123', buildingId: 'b1', unitType: 'APARTAMENTO', label: null, building: { id: 'b1', name: 'Edificio A', alias: 'A' } },
            { id: 'u2', code: 'A-0123', buildingId: 'b2', unitType: 'APARTAMENTO', label: null, building: { id: 'b2', name: 'Edificio B', alias: 'B' } },
          ]),
          findFirst: jest.fn(),
        },
        unitAssociation: { findFirst: jest.fn() },
      };
      
      const resolver = new AssistantUnitResolverService(mockPrisma);
      const result = await resolver.resolve('tenant-1', { unitCode: 'A-0123' });
      
      expect(result.resolved).toBeNull();
      expect(result.errorResponse.answer).toContain('Encontré más de una unidad A-0123');
      expect(result.errorResponse.answer).toContain('Edificio A');
      expect(result.errorResponse.answer).toContain('Edificio B');
    });

    it('should resolve unique unit across tenant without requiring building', async () => {
      const { AssistantUnitResolverService } = require('./unit-resolver/assistant-unit-resolver.service');
      
      const mockPrisma = {
        building: { findFirst: jest.fn(), findMany: jest.fn() },
        unit: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'u1', code: 'A-0123', label: null, unitType: 'APARTAMENTO', buildingId: 'b1', building: { id: 'b1', name: 'Edificio Unico', alias: 'A' } },
          ]),
          findFirst: jest.fn(),
        },
        unitAssociation: { findFirst: jest.fn() },
      };
      
      const resolver = new AssistantUnitResolverService(mockPrisma);
      const result = await resolver.resolve('tenant-1', { unitCode: 'A-0123' });
      
      expect(result.errorResponse).toBeNull();
      expect(result.resolved.displayCode).toBe('A-A-0123');
    });

    it('should resolve parking P001 with associated apartment', async () => {
      const { AssistantUnitResolverService } = require('./unit-resolver/assistant-unit-resolver.service');
      
      const mockPrisma = {
        building: {
          findFirst: jest.fn().mockResolvedValue({ id: 'b1', name: 'Torre A', alias: 'A' }),
        },
        unit: {
          findFirst: jest.fn().mockResolvedValue({ id: 'p1', code: 'P001', label: 'Puesto P001', unitType: 'ESTACIONAMIENTO' }),
          findMany: jest.fn(),
        },
        unitAssociation: {
          findFirst: jest.fn().mockResolvedValue({
            apartment: { id: 'u1', code: '0101' },
          }),
        },
      };
      
      const resolver = new AssistantUnitResolverService(mockPrisma);
      const result = await resolver.resolve('tenant-1', { unitCode: 'P001', buildingAlias: 'A' });
      
      expect(result.errorResponse).toBeNull();
      expect(result.resolved.displayCode).toBe('A-P001');
      expect(result.resolved.unit.unitType).toBe('ESTACIONAMIENTO');
      expect(result.resolved.associatedApartment).not.toBeNull();
      expect(result.resolved.associatedApartment?.code).toBe('0101');
    });

    it('should suggest unit from other building when not found', async () => {
      const { AssistantUnitResolverService } = require('./unit-resolver/assistant-unit-resolver.service');
      
      const mockPrisma = {
        building: {
          findFirst: jest.fn().mockResolvedValue({ id: 'b1', name: 'Torre A', alias: 'A' }),
        },
        unit: {
          findFirst: jest.fn()
            .mockResolvedValueOnce(null) // Not in building A
            .mockResolvedValueOnce({ // Found in building B
              id: 'u1', 
              code: '0101', 
              label: null,
              unitType: 'APARTAMENTO',
              buildingId: 'b2',
              building: { alias: 'B', name: 'Torre B' },
            }),
          findMany: jest.fn(),
        },
        unitAssociation: { findFirst: jest.fn() },
      };
      
      const resolver = new AssistantUnitResolverService(mockPrisma);
      const result = await resolver.resolve('tenant-1', { unitCode: '0101', buildingAlias: 'A' });
      
      expect(result.resolved).toBeNull();
      expect(result.errorResponse).not.toBeNull();
      expect(result.errorResponse.answer).toContain('B-0101');
      expect(result.errorResponse.answer).toContain('Torre B');
    });
  });
});
