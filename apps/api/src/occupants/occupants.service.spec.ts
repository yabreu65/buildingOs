import { NotFoundException } from '@nestjs/common';
import { OccupantsService } from './occupants.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlanEntitlementsService } from '../billing/plan-entitlements.service';
import { AuthorizeService } from '../rbac/authorize.service';
import { PrismaService } from '../prisma/prisma.service';

function expectNoPasswordHashDeep(value: unknown): void {
  const seen = new Set<unknown>();
  const visit = (current: unknown): void => {
    if (current == null || typeof current !== 'object' || seen.has(current)) {
      return;
    }

    seen.add(current);
    expect(Object.prototype.hasOwnProperty.call(current, 'passwordHash')).toBe(false);

    for (const nested of Object.values(current as Record<string, unknown>)) {
      visit(nested);
    }
  };

  visit(value);
  expect(JSON.stringify(value)).not.toContain('passwordHash');
}

describe('OccupantsService', () => {
  const prisma = {
    unit: {
      findFirst: jest.fn(),
    },
    unitOccupant: {
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    tenantMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;

  const audit = {
    createLog: jest.fn(),
  } as unknown as jest.Mocked<AuditService>;

  const notifications = {
    createNotification: jest.fn(),
  } as unknown as jest.Mocked<NotificationsService>;

  const planEntitlements = {
    assertLimit: jest.fn(),
  } as unknown as jest.Mocked<PlanEntitlementsService>;

  const authorizeService = {
    authorize: jest.fn(),
  } as unknown as jest.Mocked<AuthorizeService>;

  const service = new OccupantsService(
    prisma,
    audit,
    notifications,
    planEntitlements,
    authorizeService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.unit.findFirst.mockResolvedValue({ id: 'unit-1' } as never);
    prisma.unitOccupant.findMany.mockResolvedValue([]);
  });

  it('selects only public user fields and strips passwordHash from occupant responses', async () => {
    prisma.unitOccupant.findMany.mockResolvedValueOnce([
      {
        id: 'occupant-1',
        tenantId: 'tenant-1',
        unitId: 'unit-1',
        memberId: 'member-1',
        role: 'RESIDENT',
        createdAt: new Date('2026-07-29T00:00:00.000Z'),
        updatedAt: new Date('2026-07-29T00:00:00.000Z'),
        member: {
          id: 'member-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          name: 'Resident One',
          email: 'resident@example.com',
          phone: '+584141111111',
          role: 'RESIDENT',
          status: 'ACTIVE',
          disabledAt: null,
          notes: null,
          createdAt: new Date('2026-07-29T00:00:00.000Z'),
          updatedAt: new Date('2026-07-29T00:00:00.000Z'),
          user: {
            id: 'user-1',
            email: 'resident@example.com',
            name: 'Resident One',
            passwordHash: 'super-secret-hash',
          },
        },
      },
    ] as never);

    const result = await service.findOccupants('tenant-1', 'building-1', 'unit-1');

    expect(prisma.unitOccupant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { unitId: 'unit-1' },
        include: {
          member: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  name: true,
                },
              },
            },
          },
        },
      }),
    );
    expect(result[0].member?.user).toEqual({
      id: 'user-1',
      email: 'resident@example.com',
      name: 'Resident One',
    });
    expectNoPasswordHashDeep(result);
  });

  it('preserves the occupant list shape while validating unit ownership', async () => {
    const result = await service.findOccupants('tenant-1', 'building-1', 'unit-1');

    expect(result).toEqual([]);
    expect(prisma.unit.findFirst).toHaveBeenCalledWith({
      where: { id: 'unit-1', building: { id: 'building-1', tenantId: 'tenant-1' } },
    });
    expectNoPasswordHashDeep(result);
  });

  it('rejects units outside the requested tenant/building scope', async () => {
    prisma.unit.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.findOccupants('tenant-1', 'building-1', 'unit-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.unitOccupant.findMany).not.toHaveBeenCalled();
  });
});
