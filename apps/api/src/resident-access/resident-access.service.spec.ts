import { NotFoundException } from '@nestjs/common';
import { ResidentAccessService } from './resident-access.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ResidentAccessService', () => {
  const prisma = {
    unitOccupant: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  } as unknown as PrismaService;
  const service = new ResidentAccessService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('returns every active unit for a resident with multiple authorized units', async () => {
    jest.spyOn(prisma.unitOccupant, 'findMany').mockResolvedValue([
      {
        id: 'occupancy-2',
        memberId: 'member-1',
        unitId: 'unit-2',
        unit: {
          id: 'unit-2',
          code: 'B-02',
          label: 'Unidad 2',
          building: {
            id: 'building-b',
            name: 'Edificio B',
            alias: 'B',
          },
        },
      },
      {
        id: 'occupancy-1',
        memberId: 'member-1',
        unitId: 'unit-1',
        unit: {
          id: 'unit-1',
          code: 'A-01',
          label: 'Unidad 1',
          building: {
            id: 'building-a',
            name: 'Edificio A',
            alias: 'A',
          },
        },
      },
    ] as never);

    await expect(service.getActiveUnitIds('tenant-1', 'user-1')).resolves.toEqual(['unit-1', 'unit-2']);
    expect(prisma.unitOccupant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        endDate: null,
        unit: expect.objectContaining({
          building: expect.objectContaining({ deletedAt: null }),
        }),
      }),
    }));
  });

  it('resolves the first active occupancy in a stable order', async () => {
    jest.spyOn(prisma.unitOccupant, 'findMany').mockResolvedValue([
      {
        id: 'occupancy-2',
        memberId: 'member-1',
        unitId: 'unit-2',
        unit: {
          id: 'unit-2',
          code: 'B-02',
          label: 'Unidad 2',
          building: {
            id: 'building-b',
            name: 'Edificio B',
            alias: 'B',
          },
        },
      },
      {
        id: 'occupancy-1',
        memberId: 'member-1',
        unitId: 'unit-1',
        unit: {
          id: 'unit-1',
          code: 'A-01',
          label: 'Unidad 1',
          building: {
            id: 'building-a',
            name: 'Edificio A',
            alias: 'A',
          },
        },
      },
    ] as never);

    await expect(service.resolveActiveResidentOccupancy({
      tenantId: 'tenant-1',
      userId: 'user-1',
    })).resolves.toMatchObject({
      tenantId: 'tenant-1',
      buildingId: 'building-a',
      unitId: 'unit-1',
    });
  });

  it('denies a foreign unit because no active occupant row matches it', async () => {
    jest.spyOn(prisma.unitOccupant, 'findFirst').mockResolvedValue(null);

    await expect(service.assertUnitAccess('tenant-1', 'user-1', 'unit-other', 'building-1'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('denies an ended occupancy because authorization requires endDate to be null', async () => {
    jest.spyOn(prisma.unitOccupant, 'findMany').mockResolvedValue([]);

    await expect(service.assertUnitAccess('tenant-1', 'former-resident', 'unit-1'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.unitOccupant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        endDate: null,
        tenantId: 'tenant-1',
        member: expect.objectContaining({ userId: 'former-resident' }),
      }),
    }));
  });

  it('denies access to a different unit in the same building when resident only occupies one unit', async () => {
    jest.spyOn(prisma.unitOccupant, 'findMany').mockResolvedValue([
      {
        id: 'occupancy-1',
        memberId: 'member-1',
        unitId: 'unit-own',
        unit: {
          id: 'unit-own',
          code: 'A-01',
          label: 'Unidad Propia',
          building: {
            id: 'building-1',
            name: 'Edificio A',
            alias: 'A',
          },
        },
      },
    ] as never);

    await expect(service.assertUnitAccess('tenant-1', 'user-1', 'unit-neighbor', 'building-1'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not self-scope a resident who also has a privileged tenant role', () => {
    expect(service.shouldEnforce(['RESIDENT'])).toBe(true);
    expect(service.shouldEnforce(['RESIDENT', 'TENANT_ADMIN'])).toBe(false);
  });
});
