import { QueryPlannerService } from './query-planner.service';
import { ExtractedIntent } from '../intent-engine/intent.types';
import { EntityResolution } from '../intent-engine/intent.types';

describe('QueryPlannerService', () => {
  let service: QueryPlannerService;

  beforeEach(() => {
    service = new QueryPlannerService();
  });

  describe('buildPlan', () => {
    it('maps intent name to correct query shape', () => {
      const intent: ExtractedIntent = {
        intent: 'list_residents',
        entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
        filters: {},
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A', alias: 'A' },
        unit: { id: 'u-1', code: '0101', label: '101', buildingId: 'b-1' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.intent).toBe('unit_residents');
    });

    it('applies entityIds from EntityResolution', () => {
      const intent: ExtractedIntent = {
        intent: 'list_residents',
        entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
        filters: {},
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A', alias: 'A' },
        unit: { id: 'u-1', code: '0101', label: '101', buildingId: 'b-1' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.entityIds).toEqual({
        buildingId: 'b-1',
        unitId: 'u-1',
      });
    });

    it('applies pagination with defaults when no limit specified', () => {
      const intent: ExtractedIntent = {
        intent: 'list_residents',
        entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
        filters: {},
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A' },
        unit: { id: 'u-1', code: '0101', buildingId: 'b-1' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.pagination.limit).toBe(20);
      expect(plan.pagination.offset).toBeUndefined();
    });

    it('respects user-specified limit capped at maximum', () => {
      const intent: ExtractedIntent = {
        intent: 'list_residents',
        entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
        filters: { limit: 500 },
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A' },
        unit: { id: 'u-1', code: '0101', buildingId: 'b-1' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.pagination.limit).toBe(100);
    });

    it('applies limit filter correctly when within bounds', () => {
      const intent: ExtractedIntent = {
        intent: 'list_residents',
        entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
        filters: { limit: 5 },
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A' },
        unit: { id: 'u-1', code: '0101', buildingId: 'b-1' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.pagination.limit).toBe(5);
    });

    it('applies sortField and sortOrder from filters', () => {
      const intent: ExtractedIntent = {
        intent: 'list_payments',
        entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
        filters: { sortField: 'amount', sortOrder: 'desc' },
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A' },
        unit: { id: 'u-1', code: '0101', buildingId: 'b-1' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.filters.sortField).toBe('amount');
      expect(plan.filters.sortOrder).toBe('desc');
    });

    it('applies numeric amount filters', () => {
      const intent: ExtractedIntent = {
        intent: 'list_payments',
        entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
        filters: { minAmount: 10000, maxAmount: 50000 },
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A' },
        unit: { id: 'u-1', code: '0101', buildingId: 'b-1' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.filters.minAmount).toBe(10000);
      expect(plan.filters.maxAmount).toBe(50000);
    });

    it('applies status and method filters', () => {
      const intent: ExtractedIntent = {
        intent: 'list_payments',
        entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
        filters: { status: 'APPROVED', method: 'TRANSFER' },
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A' },
        unit: { id: 'u-1', code: '0101', buildingId: 'b-1' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.filters.status).toBe('APPROVED');
      expect(plan.filters.method).toBe('TRANSFER');
    });

    it('handles period filter by parsing YYYY-MM format', () => {
      const intent: ExtractedIntent = {
        intent: 'list_payments',
        entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
        filters: { period: '2024-03' },
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A' },
        unit: { id: 'u-1', code: '0101', buildingId: 'b-1' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.filters.period).toBe('2024-03');
    });

    it('returns plan with all required fields for building-level intent', () => {
      const intent: ExtractedIntent = {
        intent: 'building_debt',
        entity: { type: 'building', buildingAlias: 'A' },
        filters: {},
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A', alias: 'A' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.intent).toBe('building_debt');
      expect(plan.entityIds?.buildingId).toBe('b-1');
      expect(plan.entityIds?.unitId).toBeUndefined();
    });

    it('maps building_debt intent to correct query shape', () => {
      const intent: ExtractedIntent = {
        intent: 'building_debt',
        entity: { type: 'building', buildingAlias: 'A' },
        filters: {},
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.intent).toBe('building_debt');
    });

    it('maps building_delinquents intent to correct query shape', () => {
      const intent: ExtractedIntent = {
        intent: 'top_debtors',
        entity: { type: 'building', buildingAlias: 'A' },
        filters: {},
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.intent).toBe('building_delinquents');
    });

    it('maps building_stats intent to correct query shape', () => {
      const intent: ExtractedIntent = {
        intent: 'get_building_stats',
        entity: { type: 'building', buildingAlias: 'A' },
        filters: {},
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A' },
        alternatives: [],
      };

      const plan = service.buildPlan(intent, resolved);

      expect(plan.intent).toBe('building_stats');
    });
  });

  describe('buildPlan validation', () => {
    it('rejects intent name not in allowlist', () => {
      const intent: ExtractedIntent = {
        intent: 'arbitrary_unsupported_intent',
        entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
        filters: {},
        confidence: 0.9,
      };
      const resolved: EntityResolution = {
        building: { id: 'b-1', name: 'Edificio A' },
        unit: { id: 'u-1', code: '0101', buildingId: 'b-1' },
        alternatives: [],
      };

      expect(() => service.buildPlan(intent, resolved)).toThrow();
    });
  });
});
