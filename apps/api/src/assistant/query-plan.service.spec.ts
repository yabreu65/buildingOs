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
      unitCode: 'A-0101',
    }));
    expect(plan?.filters.buildingAlias).toBeUndefined();
  });

  it('creates unit debt plan for block-style unit code A1-123', () => {
    const plan = service.createPlan('deuda de la unidad A1-123');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'unit_debt',
      scope: 'unit',
    }));
    expect(plan?.filters).toEqual(expect.objectContaining({
      unitCode: 'A1-123',
    }));
    expect(plan?.filters.buildingAlias).toBeUndefined();
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

  it.each([
    'anular pago',
    'cancelar pago',
    'crear gasto',
    'editar gasto',
    'eliminar gasto',
    'borrar gasto',
    'marcar apartamento 101 como pagado',
    'registrar pago apartamento 101 por 50000',
    'subir comprobante',
    'cargar comprobante',
  ])('rejects write phrase "%s"', (phrase) => {
    expect(service.createPlan(phrase)).toBeNull();
  });

  it.each([
    'deuda de la administracion',
    'deuda total de la administracion',
    'saldo pendiente general',
    'cuanto deben todos los edificios',
    'deuda de todos los edificios',
    'deuda de todos los condominios',
    'deuda administracion',
    'deuda total de todo',
    'cuanto deben todos',
    'morosidad global',
    'saldo general',
  ])('maps "%s" to tenant_debt', (phrase) => {
    const plan = service.createPlan(phrase);

    expect(plan).toEqual(expect.objectContaining({
      intent: 'tenant_debt',
      module: 'payments',
      scope: 'tenant',
      requiredPermission: 'payments.review',
      executor: 'tenant_debt',
    }));
  });

  it.each([
    'deuda del condominio',
    'deuda del condominio completo',
    'deuda total del condominio',
    'deuda del edificio',
    'deuda del building',
  ])('maps "%s" to building_debt', (phrase) => {
    const plan = service.createPlan(phrase);

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_debt',
      module: 'payments',
      scope: 'building',
      requiredPermission: 'payments.review',
      executor: 'building_debt',
    }));
  });

  it.each([
    ['deuda de este mes de la administracion', 'current_month'],
    ['deuda acumulada de la administracion', 'accumulated'],
    ['deuda total de este mes', 'current_month'],
  ])('preserves tenant debt period for "%s"', (phrase, expectedPeriod) => {
    const plan = service.createPlan(phrase);

    expect(plan).toEqual(expect.objectContaining({
      intent: 'tenant_debt',
      scope: 'tenant',
    }));
    expect(plan?.filters.period).toBe(expectedPeriod);
  });

  it('preserves current month for building debt on a condominio phrase', () => {
    const plan = service.createPlan('deuda del mes actual del condominio');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_debt',
      scope: 'building',
    }));
    expect(plan?.filters.period).toBe(new Date().toISOString().slice(0, 7));
  });

  it('does not fall back to tenant_debt for condominio phrases', () => {
    const plan = service.createPlan('deuda del condominio');

    expect(plan?.intent).toBe('building_debt');
    expect(plan?.scope).toBe('building');
    expect(plan?.filters.buildingAlias).toBeUndefined();
    expect(plan?.filters.buildingToken).toBeUndefined();
  });

  it('returns null for non-allowlisted or ambiguous questions', () => {
    expect(service.createPlan('hola como estas')).toBeNull();
    expect(service.createPlan('deuda')).toBeNull();
  });

  it.each([
    'cuanto se cobro hoy',
    'recaudacion del mes',
    'ingresos del condominio',
  ])('does not classify "%s" as debt', (phrase) => {
    const plan = service.createPlan(phrase);

    expect(plan?.intent).not.toBe('tenant_debt');
    expect(plan?.intent).not.toBe('building_debt');
  });

  it.each([
    'crear pago de la unidad A-0101',
    'actualizar deuda del edificio B',
    'eliminar ticket del Edificio Norte',
  ])('blocks write-intent finance phrases like "%s"', (phrase) => {
    expect(service.createPlan(phrase)).toBeNull();
  });

  it('detects building-level intent without explicit building token', () => {
    const plan = service.createPlan('Hay alguien que este tardando en pagar el mantenimiento');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_delinquents',
      scope: 'building',
      requiredPermission: 'payments.review',
      confidence: 0.85,
      source: 'deterministic_rules',
    }));
    expect(plan?.filters).toEqual({});
  });

  it('extracts period and payment method from natural language filters', () => {
    const plan = service.createPlan('Pagos de enero por transferencia');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_payments',
    }));
    expect(plan?.filters.period).toMatch(/^\d{4}-01$/);
    expect(plan?.filters.method).toBe('TRANSFER');
  });

  it('treats mes actual as the current period for building debt', () => {
    const plan = service.createPlan('deuda del edificio B, del mes actual');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_debt',
    }));
    expect(plan?.filters.buildingAlias).toBe('B');
    expect(plan?.filters.period).toBe(new Date().toISOString().slice(0, 7));
  });

  it('parses explicit month and year for building debt', () => {
    const plan = service.createPlan('deuda del edificio B, junio 2026');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_debt',
    }));
    expect(plan?.filters.buildingAlias).toBe('B');
    expect(plan?.filters.period).toBe('2026-06');
  });

  it('keeps este mes behavior unchanged for building debt', () => {
    const plan = service.createPlan('deuda del edificio B este mes');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_debt',
    }));
    expect(plan?.filters.buildingAlias).toBe('B');
    expect(plan?.filters.period).toBe(new Date().toISOString().slice(0, 7));
  });

  it('keeps building-level debt queries with month and year out of unit_debt parsing', () => {
    const plan = service.createPlan('deuda del edificio B, junio 2026');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_debt',
    }));
    expect(plan?.filters.buildingAlias).toBe('B');
    expect(plan?.filters.period).toBe('2026-06');
    expect(plan?.filters.unitCode).toBeUndefined();
    expect(plan?.filters.unitCodeRaw).toBeUndefined();
  });

  it('keeps building-level payments queries with month and year out of unit parsing', () => {
    const plan = service.createPlan('pagos pendientes edificio B junio 2026');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_payments',
    }));
    expect(plan?.filters.buildingAlias).toBe('B');
    expect(plan?.filters.period).toBe('2026-06');
    expect(plan?.filters.unitCode).toBeUndefined();
  });

  it('detects bank-income phrasing and maps it to building_payments with transfer method', () => {
    const plan = service.createPlan('Mostrame la plata que entró por banco el mes pasado');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_payments',
    }));
    expect(plan?.filters.method).toBe('TRANSFER');
    expect(plan?.filters.period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('maps explicit building token into buildingAlias for downstream resolver', () => {
    const plan = service.createPlan('Mostrame la plata que entró por banco el mes pasado en Torre A');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_payments',
    }));
    expect(plan?.filters.buildingAlias).toBe('A');
    expect(plan?.filters.buildingToken).toBe('A');
  });

  it('keeps valid unit queries working when the unit code is real', () => {
    const plan = service.createPlan('deuda unidad 2-B');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'unit_debt',
    }));
    expect(plan?.filters.unitCode).toBe('2-B');
  });

  it('keeps accumulated building debt without a period filter', () => {
    const plan = service.createPlan('deuda acumulada edificio B');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_debt',
    }));
    expect(plan?.filters.buildingAlias).toBe('B');
    expect(plan?.filters.period).toBeUndefined();
  });

  it('extracts status and minAgeDays from ticket aging query', () => {
    const plan = service.createPlan('Tickets abiertos hace más de 7 días');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_tickets',
    }));
    expect(plan?.filters.status).toBe('OPEN');
    expect(plan?.filters.minAgeDays).toBe(7);
  });

  it('classifies debt comparison with someone as delinquents and extracts minDebt', () => {
    const plan = service.createPlan('¿Hay alguien con deuda mayor a 500?');

    expect(plan).toEqual(expect.objectContaining({
      intent: 'building_delinquents',
    }));
    expect(plan?.filters.minDebt).toBe(500);
  });
});
