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
      { unitId: 'unit-1' },
      { unitId: 'unit-2' },
    ] as never);

    await expect(service.getActiveUnitIds('tenant-1', 'user-1')).resolves.toEqual(['unit-1', 'unit-2']);
    expect(prisma.unitOccupant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-1', endDate: null }),
    }));
  });

  it('denies a foreign unit because no active occupant row matches it', async () => {
    jest.spyOn(prisma.unitOccupant, 'findFirst').mockResolvedValue(null);

    await expect(service.assertUnitAccess('tenant-1', 'user-1', 'unit-other', 'building-1'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('denies an ended occupancy because authorization requires endDate to be null', async () => {
    jest.spyOn(prisma.unitOccupant, 'findFirst').mockResolvedValue(null);

    await expect(service.assertUnitAccess('tenant-1', 'former-resident', 'unit-1'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.unitOccupant.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ endDate: null, unitId: 'unit-1' }),
    }));
  });

  it('does not self-scope a resident who also has a privileged tenant role', () => {
    expect(service.shouldEnforce(['RESIDENT'])).toBe(true);
    expect(service.shouldEnforce(['RESIDENT', 'TENANT_ADMIN'])).toBe(false);
  });
});
