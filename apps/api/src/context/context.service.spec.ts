import { NotFoundException } from '@nestjs/common';
import { ContextService } from './context.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizeService } from '../rbac/authorize.service';
import { ResidentAccessService } from '../resident-access/resident-access.service';

describe('ContextService', () => {
  const prisma = {
    membership: {
      findUnique: jest.fn(),
    },
    userContext: {
      upsert: jest.fn(),
      create: jest.fn(),
    },
    building: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    unit: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  } as PrismaService;

  const authorize = {
    authorize: jest.fn(),
  } as AuthorizeService;

  const residentAccess = {
    shouldEnforce: jest.fn(),
    resolveActiveResidentOccupancy: jest.fn(),
    getActiveUnitIds: jest.fn(),
    getActiveBuildingIds: jest.fn(),
    assertUnitAccess: jest.fn(),
    assertBuildingAccess: jest.fn(),
  } as ResidentAccessService;

  const service = new ContextService(prisma, authorize, residentAccess);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back to the first active resident occupancy when the saved selection is stale', async () => {
    jest.spyOn(prisma.membership, 'findUnique').mockResolvedValue({
      id: 'membership-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userContext: {
        activeBuildingId: 'building-stale',
        activeUnitId: 'unit-stale',
      },
      roles: [{ role: 'RESIDENT' }],
    });
    jest.spyOn(residentAccess, 'shouldEnforce').mockReturnValue(true);
    jest.spyOn(residentAccess, 'resolveActiveResidentOccupancy')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        occupancyId: 'occupancy-1',
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        buildingName: 'Edificio A',
        buildingAlias: 'A',
        unitId: 'unit-1',
        unitCode: 'A-01',
        unitLabel: 'Unidad 1',
        memberId: 'member-1',
      });
    jest.spyOn(prisma.userContext, 'upsert').mockResolvedValue({
      tenantId: 'tenant-1',
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    });

    await expect(service.getContext('user-1', 'tenant-1')).resolves.toEqual({
      tenantId: 'tenant-1',
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    });

    expect(prisma.userContext.upsert).toHaveBeenCalledWith({
      where: { membershipId: 'membership-1' },
      update: {
        tenantId: 'tenant-1',
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-1',
      },
      create: {
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-1',
      },
    });
  });

  it('reconciles mixed-role resident context when the resident portal is explicit', async () => {
    jest.spyOn(prisma.membership, 'findUnique').mockResolvedValue({
      id: 'membership-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userContext: {
        activeBuildingId: 'building-archived',
        activeUnitId: 'unit-archived',
      },
      roles: [
        { role: 'RESIDENT' },
        { role: 'TENANT_ADMIN', scopeType: 'TENANT', scopeBuildingId: null },
      ],
    });
    jest.spyOn(residentAccess, 'resolveActiveResidentOccupancy')
      .mockResolvedValueOnce({
        occupancyId: 'occupancy-1',
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        buildingName: 'Edificio A',
        buildingAlias: 'A',
        unitId: 'unit-1',
        unitCode: 'A-01',
        unitLabel: 'Unidad 1',
        memberId: 'member-1',
      });
    jest.spyOn(prisma.userContext, 'upsert').mockResolvedValue({
      tenantId: 'tenant-1',
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    });

    await expect(service.getContext('user-1', 'tenant-1', 'resident')).resolves.toEqual({
      tenantId: 'tenant-1',
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    });

    expect(residentAccess.resolveActiveResidentOccupancy).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      unitId: 'unit-archived',
    });
    expect(prisma.userContext.upsert).toHaveBeenCalledWith({
      where: { membershipId: 'membership-1' },
      update: {
        tenantId: 'tenant-1',
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-1',
      },
      create: {
        tenantId: 'tenant-1',
        membershipId: 'membership-1',
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-1',
      },
    });
  });

  it('omits archived buildings and their units from tenant-scoped context options', async () => {
    jest.spyOn(prisma.membership, 'findUnique').mockResolvedValue({
      id: 'membership-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userContext: null,
      roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT', scopeBuildingId: null }],
    });
    jest.spyOn(residentAccess, 'shouldEnforce').mockReturnValue(false);
    jest.spyOn(prisma.building, 'findMany').mockResolvedValue([
      { id: 'building-active', name: 'Edificio Activo' },
    ]);
    jest.spyOn(prisma.unit, 'findMany').mockResolvedValue([
      { id: 'unit-1', code: 'A-01', label: 'Unidad 1' },
    ]);

    await expect(service.getContextOptions('user-1', 'tenant-1')).resolves.toEqual({
      buildings: [
        { id: 'building-active', name: 'Edificio Activo' },
      ],
      unitsByBuilding: {
        'building-active': [
          { id: 'unit-1', code: 'A-01', label: 'Unidad 1' },
        ],
      },
    });

    expect(prisma.building.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', deletedAt: null },
      select: { id: true, name: true },
    });
    expect(prisma.unit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        buildingId: 'building-active',
        building: { deletedAt: null },
      }),
    }));
  });

  it('normalizes a resident building-only selection to the first active unit in that building', async () => {
    jest.spyOn(prisma.membership, 'findUnique').mockResolvedValue({
      id: 'membership-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userContext: null,
      roles: [{ role: 'RESIDENT' }],
    });
    jest.spyOn(residentAccess, 'shouldEnforce').mockReturnValue(true);
    jest.spyOn(residentAccess, 'resolveActiveResidentOccupancy').mockResolvedValue({
      occupancyId: 'occupancy-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      buildingName: 'Edificio A',
      buildingAlias: 'A',
      unitId: 'unit-1',
      unitCode: 'A-01',
      unitLabel: 'Unidad 1',
      memberId: 'member-1',
    });
    jest.spyOn(prisma.building, 'findFirst').mockResolvedValue({
      id: 'building-1',
      tenantId: 'tenant-1',
      name: 'Edificio A',
    });
    jest.spyOn(prisma.userContext, 'upsert').mockResolvedValue({
      tenantId: 'tenant-1',
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    });

    await expect(service.setContext('user-1', 'tenant-1', 'building-1', null)).resolves.toEqual({
      tenantId: 'tenant-1',
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    });

    expect(residentAccess.resolveActiveResidentOccupancy).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      buildingId: 'building-1',
    });
  });

  it('rejects a resident unit that is not authorized in the current tenant', async () => {
    jest.spyOn(prisma.membership, 'findUnique').mockResolvedValue({
      id: 'membership-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userContext: null,
      roles: [{ role: 'RESIDENT' }],
    });
    jest.spyOn(residentAccess, 'shouldEnforce').mockReturnValue(true);
    jest.spyOn(residentAccess, 'resolveActiveResidentOccupancy').mockResolvedValue(null);

    await expect(service.setContext('user-1', 'tenant-1', null, 'unit-other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects archived buildings when setting a tenant-scoped context', async () => {
    jest.spyOn(prisma.membership, 'findUnique').mockResolvedValue({
      id: 'membership-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userContext: null,
      roles: [{ role: 'TENANT_ADMIN' }],
    });
    jest.spyOn(residentAccess, 'shouldEnforce').mockReturnValue(false);
    jest.spyOn(prisma.building, 'findFirst').mockResolvedValue(null);

    await expect(
      service.setContext('user-1', 'tenant-1', 'building-archived', null),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.building.findFirst).toHaveBeenCalledWith({
      where: { id: 'building-archived', tenantId: 'tenant-1', deletedAt: null },
    });
  });

  it('keeps the resident context empty when there are no active occupancies', async () => {
    jest.spyOn(prisma.membership, 'findUnique').mockResolvedValue({
      id: 'membership-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userContext: null,
      roles: [{ role: 'RESIDENT' }],
    });
    jest.spyOn(residentAccess, 'shouldEnforce').mockReturnValue(true);
    jest.spyOn(residentAccess, 'resolveActiveResidentOccupancy').mockResolvedValue(null);
    jest.spyOn(prisma.userContext, 'upsert').mockResolvedValue({
      tenantId: 'tenant-1',
      activeBuildingId: null,
      activeUnitId: null,
    });

    await expect(service.getContext('user-1', 'tenant-1')).resolves.toEqual({
      tenantId: 'tenant-1',
      activeBuildingId: null,
      activeUnitId: null,
    });
  });

  it('omits archived buildings from tenant-wide context options', async () => {
    jest.spyOn(prisma.membership, 'findUnique').mockResolvedValue({
      id: 'membership-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userContext: null,
      roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
    });
    jest.spyOn(prisma.building, 'findMany').mockResolvedValue([
      { id: 'building-active', name: 'Edificio Activo' },
    ]);
    jest.spyOn(prisma.unit, 'findMany').mockResolvedValue([]);
    jest.spyOn(residentAccess, 'shouldEnforce').mockReturnValue(false);

    await expect(service.getContextOptions('user-1', 'tenant-1')).resolves.toEqual({
      buildings: [{ id: 'building-active', name: 'Edificio Activo' }],
      unitsByBuilding: {
        'building-active': [],
      },
    });

    expect(prisma.building.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1', deletedAt: null },
      }),
    );
  });
});
