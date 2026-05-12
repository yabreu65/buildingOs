import { ResponseFormatterService } from './response-formatter.service';

describe('ResponseFormatterService', () => {
  let service: ResponseFormatterService;

  beforeEach(() => {
    service = new ResponseFormatterService();
  });

  describe('formatV1', () => {
    it('returns backward compatible ChatResponse', () => {
      const data = [{ id: '1', name: 'Test' }];
      const result = service.formatV1(data, 'list_residents');

      expect(result).toHaveProperty('answer');
      expect(result).toHaveProperty('suggestedActions');
      expect(Array.isArray(result.suggestedActions)).toBe(true);
    });

    it('converts tables to markdown', () => {
      const data = [
        { id: '1', name: 'John', amount: 1000 },
        { id: '2', name: 'Jane', amount: 2000 },
      ];
      const result = service.formatV1(data, 'list_payments');

      expect(result.answer).toContain('|');
      expect(result.answer).toContain('id');
      expect(result.answer).toContain('name');
    });

    it('formats money with es-VE locale', () => {
      const data = [{ id: '1', description: 'Test', amount: 10500 }];
      const result = service.formatV1(data, 'list_payments');

      // es-VE format should show decimal places
      expect(result.answer).toMatch(/\d+,\d{2}/);
    });

    it('formats dates correctly', () => {
      const data = [{ id: '1', date: '2024-03-15T10:00:00Z' }];
      const result = service.formatV1(data, 'list_payments');

      // Should format as locale date string
      expect(result.answer).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    });
  });

  describe('formatV2', () => {
    it('returns StructuredResponse with type field', () => {
      const data = [{ id: '1', name: 'Test' }];
      const result = service.formatV2(data, 'list_residents', 0.9);

      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('data');
    });

    it('sets type to table for list data', () => {
      const data = [
        { id: '1', name: 'John' },
        { id: '2', name: 'Jane' },
      ];
      const result = service.formatV2(data, 'list_residents', 0.9);

      expect(result.type).toBe('table');
    });

    it('sets type to kpi for single value', () => {
      const data = { totalDebt: 50000, currency: 'ARS' };
      const result = service.formatV2(data, 'unit_debt', 0.9);

      expect(result.type).toBe('kpi');
    });

    it('includes suggestedActions based on intent type', () => {
      const data = [{ id: '1', name: 'Test' }];
      const result = service.formatV2(data, 'list_payments', 0.9);

      expect(result.actions).toBeDefined();
      expect(Array.isArray(result.actions)).toBe(true);
    });

    it('sets confidence in meta', () => {
      const data = [{ id: '1', name: 'Test' }];
      const result = service.formatV2(data, 'list_residents', 0.85);

      expect(result.meta?.confidence).toBe(0.85);
    });
  });

  describe('formatter support', () => {
    it('supports text formatter', () => {
      const data = 'Simple text response';
      const result = service.formatV1(data, 'get_balance');

      expect(result.answer).toBeDefined();
    });

    it('supports clarification formatter', () => {
      const data = {
        isAmbiguous: true,
        alternatives: [
          { id: '1', displayName: 'Building A' },
          { id: '2', displayName: 'Building B' },
        ],
      };
      const result = service.formatV2(data, 'clarification', 0.5);

      expect(result.type).toBe('clarification');
    });
  });
});
