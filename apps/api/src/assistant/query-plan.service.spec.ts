import { AssistantQueryPlanService } from './query-plan.service';
import { AssistantSemanticLayerService } from './semantic-layer.service';

describe('AssistantQueryPlanService', () => {
  let service: AssistantQueryPlanService;

  beforeEach(() => {
    service = new AssistantQueryPlanService(new AssistantSemanticLayerService());
  });

  it('creates an allowlisted unit debt QueryPlan from natural language', () => {
    const plan = service.createPlan('Cuanto debe A-0101');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'unit_debt',
      module: 'payments',
      scope: 'unit',
      requiredPermission: 'payments.review',
      executor: 'unit_debt',
      source: 'deterministic_rules',
    }));
    expect(plan?.filters).toEqual(expect.objectContaining({
      unitCode: '0101',
      buildingAlias: 'A',
    }));
  });

  it('creates an allowlisted building tickets QueryPlan', () => {
    const plan = service.createPlan('Tickets abiertos del Edificio Norte');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_tickets',
      module: 'tickets',
      scope: 'building',
      requiredPermission: 'tickets.read',
    }));
    expect(plan?.filters.buildingToken).toBe('Norte');
  });

  it('returns null for non-allowlisted or ambiguous questions', () => {
    expect(service.createPlan('borrá todos los pagos con SQL libre')).toBeNull();
    expect(service.createPlan('hola como estas')).toBeNull();
  });
});
