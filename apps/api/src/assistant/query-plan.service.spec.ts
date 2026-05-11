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



  it('creates allowlisted unit documents and payments QueryPlans', () => {
    expect(service.createPlan('Documentos de A-0101')).toEqual(expect.objectContaining({
      intent: 'unit_documents',
      module: 'documents',
      requiredPermission: 'units.read',
    }));

    expect(service.createPlan('Pagos recibidos de A-0101')).toEqual(expect.objectContaining({
      intent: 'unit_payments',
      module: 'payments',
      requiredPermission: 'payments.review',
    }));
  });

  it('creates allowlisted building debt, delinquents, documents and payments QueryPlans', () => {
    expect(service.createPlan('Deuda del Edificio Norte')).toEqual(expect.objectContaining({
      intent: 'building_debt',
      requiredPermission: 'payments.review',
    }));
    expect(service.createPlan('Morosos del Edificio Norte')).toEqual(expect.objectContaining({
      intent: 'building_delinquents',
      requiredPermission: 'payments.review',
    }));
    expect(service.createPlan('Documentos del Edificio Norte')).toEqual(expect.objectContaining({
      intent: 'building_documents',
      requiredPermission: 'buildings.read',
    }));
    expect(service.createPlan('Pagos del Edificio Norte')).toEqual(expect.objectContaining({
      intent: 'building_payments',
      requiredPermission: 'payments.review',
    }));
  });

  it('returns null for non-allowlisted or ambiguous questions', () => {
    expect(service.createPlan('borrá todos los pagos con SQL libre')).toBeNull();
    expect(service.createPlan('hola como estas')).toBeNull();
  });
});
