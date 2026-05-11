import { PaymentStatus, UnitOccupantRole } from '@prisma/client';
import { AssistantQueryExecutorsService } from './query-executors.service';
import type { AssistantQueryPlan } from './query-plan.types';

describe('AssistantQueryExecutorsService', () => {
  const prisma = {
    tenant: { findUniqueOrThrow: jest.fn() },
    charge: { findMany: jest.fn() },
    unitOccupant: { findMany: jest.fn() },
    ticket: { count: jest.fn(), findMany: jest.fn() },
    unit: { findMany: jest.fn() },
    building: { findMany: jest.fn() },
  };
  const policy = { assertCanExecute: jest.fn() };
  const unitResolver = { resolve: jest.fn() };
  let service: AssistantQueryExecutorsService;

  const resolvedUnit = {
    building: { id: 'building-1', name: 'Edificio A', alias: 'A' },
    unit: { id: 'unit-1', code: '0101', label: 'Unidad 0101', unitType: 'APARTAMENTO' },
    displayCode: 'A-0101',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AssistantQueryExecutorsService(prisma as never, policy as never, unitResolver as never);
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
    prisma.charge.findMany.mockResolvedValue([
      {
        amount: 100000,
        paymentAllocations: [
          { amount: 25000, payment: { status: PaymentStatus.APPROVED } },
          { amount: 30000, payment: { status: PaymentStatus.SUBMITTED } },
        ],
      },
    ]);

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
    expect(prisma.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', unitId: 'unit-1', canceledAt: null },
    }));
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

    const result = await service.execute({ tenantId: 'tenant-1', userId: 'operator-1', userRoles: ['OPERATOR'], plan });

    expect(policy.assertCanExecute).toHaveBeenCalledWith(expect.objectContaining({ buildingId: 'building-1' }));
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', buildingId: 'building-1' },
    }));
    expect(result?.answer).toContain('Ascensor');
  });
});
