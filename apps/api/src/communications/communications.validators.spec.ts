import { MemberStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CommunicationsValidators } from './communications.validators';

interface PrismaMock {
  readonly communicationTarget: { findMany: jest.Mock };
  readonly communicationReceipt: { findFirst: jest.Mock };
  readonly user: { findMany: jest.Mock };
  readonly unitOccupant: { findMany: jest.Mock };
}

const tenantId = 'tenant-1';
const communicationId = 'communication-1';
const buildingId = 'building-1';
const unitId = 'unit-1';

describe('CommunicationsValidators recipient eligibility', () => {
  let prisma: PrismaMock;
  let validators: CommunicationsValidators;

  beforeEach(() => {
    prisma = {
      communicationTarget: { findMany: jest.fn() },
      communicationReceipt: { findFirst: jest.fn() },
      user: { findMany: jest.fn() },
      unitOccupant: { findMany: jest.fn() },
    };
    validators = new CommunicationsValidators(prisma as unknown as PrismaService);
  });

  it('filters ALL_TENANT recipients to active tenant members only', async () => {
    prisma.communicationTarget.findMany.mockResolvedValue([
      { targetType: 'ALL_TENANT', targetId: null },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);

    await expect(
      validators.resolveRecipients(tenantId, communicationId, prisma as unknown as Prisma.TransactionClient),
    ).resolves.toEqual(['user-1', 'user-2']);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        memberships: {
          some: {
            tenantId,
          },
        },
        tenantMembers: {
          some: {
            tenantId,
            disabledAt: null,
            status: MemberStatus.ACTIVE,
          },
        },
      },
      select: { id: true },
    });
  });

  it('filters BUILDING recipients to active current occupancies only', async () => {
    prisma.communicationTarget.findMany.mockResolvedValue([
      { targetType: 'BUILDING', targetId: buildingId },
    ]);
    prisma.unitOccupant.findMany.mockResolvedValue([
      { member: { userId: 'user-1' } },
    ]);

    await expect(
      validators.resolveRecipients(tenantId, communicationId, prisma as unknown as Prisma.TransactionClient),
    ).resolves.toEqual(['user-1']);

    expect(prisma.unitOccupant.findMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        endDate: null,
        unit: {
          building: {
            id: buildingId,
            tenantId,
          },
        },
        member: {
          tenantId,
          disabledAt: null,
          status: MemberStatus.ACTIVE,
          userId: { not: null },
        },
      },
      include: { member: { select: { userId: true } } },
      distinct: ['memberId'],
    });
  });

  it('filters UNIT recipients to active current occupancies only', async () => {
    prisma.communicationTarget.findMany.mockResolvedValue([
      { targetType: 'UNIT', targetId: unitId },
    ]);
    prisma.unitOccupant.findMany.mockResolvedValue([
      { member: { userId: 'user-1' } },
    ]);

    await expect(
      validators.resolveRecipients(tenantId, communicationId, prisma as unknown as Prisma.TransactionClient),
    ).resolves.toEqual(['user-1']);

    expect(prisma.unitOccupant.findMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        endDate: null,
        unitId,
        unit: {
          building: { tenantId },
        },
        member: {
          tenantId,
          disabledAt: null,
          status: MemberStatus.ACTIVE,
          userId: { not: null },
        },
      },
      include: { member: { select: { userId: true } } },
      distinct: ['memberId'],
    });
  });

  it('filters ROLE recipients to active tenant members only and deduplicates overlapping targets', async () => {
    prisma.communicationTarget.findMany.mockResolvedValue([
      { targetType: 'ALL_TENANT', targetId: null },
      { targetType: 'ROLE', targetId: 'RESIDENT' },
    ]);
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: 'user-1' }, { id: 'user-2' }])
      .mockResolvedValueOnce([{ id: 'user-2' }, { id: 'user-3' }]);

    await expect(
      validators.resolveRecipients(tenantId, communicationId, prisma as unknown as Prisma.TransactionClient),
    ).resolves.toEqual(['user-1', 'user-2', 'user-3']);

    expect(prisma.user.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        memberships: {
          some: {
            tenantId,
            roles: {
              some: {
                role: 'RESIDENT',
              },
            },
          },
        },
        tenantMembers: {
          some: {
            tenantId,
            disabledAt: null,
            status: MemberStatus.ACTIVE,
          },
        },
      },
      select: { id: true },
    });
  });

  it('uses tenant scope when checking resident access to a communication', async () => {
    prisma.communicationReceipt.findFirst.mockResolvedValue({ id: 'receipt-1' });

    await expect(
      validators.canUserReadCommunication(tenantId, 'user-1', communicationId, ['RESIDENT']),
    ).resolves.toBe(true);

    expect(prisma.communicationReceipt.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId,
        communicationId,
        userId: 'user-1',
      },
      select: { id: true },
    });
  });
});
