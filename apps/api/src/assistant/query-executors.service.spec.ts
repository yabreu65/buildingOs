import { PaymentStatus, UnitOccupantRole } from '@prisma/client';
import { AssistantQueryExecutorsService } from './query-executors.service';
import type { AssistantQueryPlan } from './query-plan.types';

describe('AssistantQueryExecutorsService', () => {
  const prisma = {
    tenant: { findUniqueOrThrow: jest.fn() },
    charge: { findMany: jest.fn() },
    unitOccupant: { findMany: jest.fn() },
    ticket: { count: jest.fn(), findMany: jest.fn() },
    document: { findMany: jest.fn() },
    payment: { findMany: jest.fn() },
    unit: { findMany: jest.fn() },
    building: { findMany: jest.fn() },
  };
  const policy = { assertCanExecute: jest.fn() };
  const unitResolver = { resolve: jest.fn() };
  const finanzasService = {
    getUnitLedger: jest.fn(),
    getBuildingFinancialSummary: jest.fn(),
    getTenantFinancialSummary: jest.fn(),
  };
  let service: AssistantQueryExecutorsService;

  const resolvedUnit = {
    building: { id: 'building-1', name: 'Edificio A', alias: 'A' },
    unit: { id: 'unit-1', code: '0101', label: 'Unidad 0101', unitType: 'APARTAMENTO' },
    displayCode: 'A-0101',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AssistantQueryExecutorsService(
      prisma as never,
      policy as never,
      unitResolver as never,
      finanzasService as never,
    );
    unitResolver.resolve.mockResolvedValue({ resolved: resolvedUnit, errorResponse: null });
    policy.assertCanExecute.mockResolvedValue(undefined);
  });

  it('executes unit_debt through allowlisted Prisma reads after policy enforcement', async () => {
    const plan: AssistantQueryPlan = {
      intent: 'unit_debt',
      module: 'payments',
      scope: 'unit',
      requiredPermission: 'payments.review',
      executor: 'unit_debt',
      filters: { unitCode: '0101', buildingAlias: 'A' },
      confidence: 0.92,
      source: 'deterministic_rules',
    };
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({ currency: 'ARS' });
    finanzasService.getUnitLedger.mockResolvedValue({
      totals: {
        balance: 75000,
        currency: 'ARS',
      },
    });

    const result = await service.execute({
      tenantId: 'tenant-1',
      userId: 'operator-1',
      userRoles: ['OPERATOR'],
      plan,
    });

    expect(policy.assertCanExecute).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'operator-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      plan,
    }));
    expect(finanzasService.getUnitLedger).toHaveBeenCalledWith(
      'tenant-1',
      'unit-1',
      undefined,
      undefined,
      ['OPERATOR'],
      'operator-1',
    );
    expect(result?.answer).toContain('deuda pendiente');
    expect(result?.suggestedActions[0].type).toBe('VIEW_PAYMENTS');
  });

  it('executes unit_residents without exposing another tenant because resolver and query are tenant-scoped', async () => {
    const plan: AssistantQueryPlan = {
      intent: 'unit_residents',
      module: 'units',
      scope: 'unit',
      requiredPermission: 'units.read',
      executor: 'unit_residents',
      filters: { unitCode: '0101', buildingAlias: 'A' },
      confidence: 0.92,
      source: 'deterministic_rules',
    };
    prisma.unitOccupant.findMany.mockResolvedValue([
      { isPrimary: true, role: UnitOccupantRole.OWNER, member: { id: 'member-1', name: 'Juana Perez' } },
    ]);

    const result = await service.execute({ tenantId: 'tenant-1', userId: 'admin-1', userRoles: ['TENANT_ADMIN'], plan });

    expect(unitResolver.resolve).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ unitCode: '0101', buildingAlias: 'A' }));
    expect(prisma.unitOccupant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', unitId: 'unit-1', endDate: null },
    }));
    expect(result?.answer).toContain('Juana Perez');
  });



  it('executes unit_documents with tenant and unit scoped filters', async () => {
    const plan: AssistantQueryPlan = {
      intent: 'unit_documents',
      module: 'documents',
      scope: 'unit',
      requiredPermission: 'units.read',
      executor: 'unit_documents',
      filters: { unitCode: '0101', buildingAlias: 'A' },
      confidence: 0.92,
      source: 'deterministic_rules',
    };
    prisma.document.findMany.mockResolvedValue([
      { id: 'doc-1', title: 'Acta Asamblea', category: 'ACTA', createdAt: new Date() },
    ]);

    const result = await service.execute({ tenantId: 'tenant-1', userId: 'admin-1', userRoles: ['TENANT_ADMIN'], plan });

    expect(policy.assertCanExecute).toHaveBeenCalledWith(expect.objectContaining({
      buildingId: 'building-1',
      unitId: 'unit-1',
      plan,
    }));
    expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', unitId: 'unit-1' },
    }));
    expect(result?.answer).toContain('Acta Asamblea');
    expect(result?.suggestedActions[0].type).toBe('VIEW_DOCUMENTS');
  });

  it('executes building_debt with tenant and building scoped charge filters', async () => {
    const plan: AssistantQueryPlan = {
      intent: 'building_debt',
      module: 'payments',
      scope: 'building',
      requiredPermission: 'payments.review',
      executor: 'building_debt',
      filters: { buildingToken: 'A' },
      confidence: 0.9,
      source: 'deterministic_rules',
    };
    prisma.building.findMany.mockResolvedValue([{ id: 'building-1', name: 'Edificio A' }]);
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({ currency: 'ARS' });
    finanzasService.getBuildingFinancialSummary.mockResolvedValue({
      totalCharges: 150000,
      totalPaid: 50000,
      totalOutstanding: 100000,
      delinquentUnitsCount: 1,
      topDelinquentUnits: [],
      currency: 'ARS',
    });

    const result = await service.execute({ tenantId: 'tenant-1', userId: 'operator-1', userRoles: ['OPERATOR'], plan });

    expect(policy.assertCanExecute).toHaveBeenCalledWith(expect.objectContaining({ buildingId: 'building-1' }));
    expect(finanzasService.getBuildingFinancialSummary).toHaveBeenCalledWith('tenant-1', 'building-1', undefined);
    expect(result?.answer).toContain('deuda pendiente total');
  });

  it('executes tenant_debt with a tenant-wide outstanding debt summary', async () => {
    const plan: AssistantQueryPlan = {
      intent: 'tenant_debt',
      module: 'payments',
      scope: 'tenant',
      requiredPermission: 'payments.review',
      executor: 'tenant_debt',
      filters: {},
      confidence: 0.9,
      source: 'deterministic_rules',
    };
    finanzasService.getTenantFinancialSummary.mockResolvedValue({
      totalCharges: 30000,
      totalPaid: 14199,
      totalOutstanding: 15801,
      delinquentUnitsCount: 2,
      topDelinquentUnits: [],
      currency: 'ARS',
    });

    const result = await service.execute({ tenantId: 'tenant-1', userId: 'operator-1', userRoles: ['OPERATOR'], plan });

    expect(policy.assertCanExecute).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', plan }));
    expect(finanzasService.getTenantFinancialSummary).toHaveBeenCalledWith('tenant-1');
    expect(result?.answer).toContain('administración');
    expect(result?.suggestedActions[0].type).toBe('VIEW_PAYMENTS');
  });

  it('executes building_delinquents through finance summary source of truth', async () => {
    const plan: AssistantQueryPlan = {
      intent: 'building_delinquents',
      module: 'payments',
      scope: 'building',
      requiredPermission: 'payments.review',
      executor: 'building_delinquents',
      filters: { buildingToken: 'A' },
      confidence: 0.9,
      source: 'deterministic_rules',
    };
    prisma.building.findMany.mockResolvedValue([{ id: 'building-1', name: 'Edificio A' }]);
    finanzasService.getBuildingFinancialSummary.mockResolvedValue({
      totalCharges: 200000,
      totalPaid: 50000,
      totalOutstanding: 150000,
      delinquentUnitsCount: 2,
      topDelinquentUnits: [
        { unitId: 'unit-1', unitLabel: 'Unidad 0101', buildingId: 'building-1', buildingName: 'Edificio A', outstanding: 90000 },
        { unitId: 'unit-2', unitLabel: 'Unidad 0202', buildingId: 'building-1', buildingName: 'Edificio A', outstanding: 60000 },
      ],
      currency: 'ARS',
    });

    const result = await service.execute({ tenantId: 'tenant-1', userId: 'operator-1', userRoles: ['OPERATOR'], plan });

    expect(finanzasService.getBuildingFinancialSummary).toHaveBeenCalledWith('tenant-1', 'building-1', undefined);
    expect(result?.answer).toContain('Top deudores');
    expect(result?.answer).toContain('Unidad 0101');
    expect(prisma.charge.findMany).not.toHaveBeenCalled();
  });

  it('executes building_payments and resolves payment unit labels inside the same tenant', async () => {
    const plan: AssistantQueryPlan = {
      intent: 'building_payments',
      module: 'payments',
      scope: 'building',
      requiredPermission: 'payments.review',
      executor: 'building_payments',
      filters: { buildingToken: 'A' },
      confidence: 0.9,
      source: 'deterministic_rules',
    };
    prisma.building.findMany.mockResolvedValue([{ id: 'building-1', name: 'Edificio A' }]);
    prisma.payment.findMany.mockResolvedValue([
      { id: 'payment-1', amount: 100000, currency: 'ARS', status: PaymentStatus.APPROVED, method: 'TRANSFER', paidAt: new Date('2026-05-01'), createdAt: new Date(), unitId: 'unit-1' },
    ]);
    prisma.unit.findMany.mockResolvedValue([{ id: 'unit-1', code: '0101', label: 'Unidad 0101' }]);
    finanzasService.getBuildingFinancialSummary.mockResolvedValue({
      totalCharges: 150000,
      totalPaid: 100000,
      totalOutstanding: 50000,
      delinquentUnitsCount: 1,
      topDelinquentUnits: [],
      currency: 'ARS',
    });

    const result = await service.execute({ tenantId: 'tenant-1', userId: 'operator-1', userRoles: ['OPERATOR'], plan });

    expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', buildingId: 'building-1', canceledAt: null },
    }));
    expect(prisma.unit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', id: { in: ['unit-1'] } },
    }));
    expect(result?.answer).toContain('Unidad 0101');
  });

  it('executes building_tickets only for the resolved building in the tenant', async () => {
    const plan: AssistantQueryPlan = {
      intent: 'building_tickets',
      module: 'tickets',
      scope: 'building',
      requiredPermission: 'tickets.read',
      executor: 'building_tickets',
      filters: { buildingToken: 'A' },
      confidence: 0.9,
      source: 'deterministic_rules',
    };
    prisma.building.findMany.mockResolvedValue([{ id: 'building-1', name: 'Edificio A' }]);
    prisma.ticket.count.mockResolvedValue(1);
    prisma.ticket.findMany.mockResolvedValue([{ id: 'ticket-1', title: 'Ascensor', status: 'OPEN', priority: 'HIGH', unitId: null, createdAt: new Date() }]);
    finanzasService.getBuildingFinancialSummary.mockResolvedValue({
      totalCharges: 160000,
      totalPaid: 90000,
      totalOutstanding: 70000,
      delinquentUnitsCount: 2,
      topDelinquentUnits: [],
      currency: 'ARS',
    });

    const result = await service.execute({ tenantId: 'tenant-1', userId: 'operator-1', userRoles: ['OPERATOR'], plan });

    expect(policy.assertCanExecute).toHaveBeenCalledWith(expect.objectContaining({ buildingId: 'building-1' }));
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', buildingId: 'building-1' },
    }));
    expect(result?.answer).toContain('Ascensor');
  });
});
