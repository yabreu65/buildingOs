import { BadRequestException, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BuildingAccessGuard, RequestWithUser } from './building-access.guard';
import { PrismaService } from '../prisma/prisma.service';

describe('BuildingAccessGuard', () => {
  const prisma = {
    building: {
      findFirst: jest.fn(),
    },
    membership: {
      findUnique: jest.fn(),
    },
  } as unknown as PrismaService;

  const guard = new BuildingAccessGuard(prisma);

  const createContext = (request: Partial<RequestWithUser> = {}): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () =>
          ({
            params: { buildingId: 'building-1', tenantId: 'tenant-1' },
            user: { id: 'user-1', memberships: [{ tenantId: 'tenant-1' }] },
            ...request,
          }) as RequestWithUser,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects archived buildings as not found', async () => {
    jest.spyOn(prisma.building, 'findFirst').mockResolvedValue({
      id: 'building-1',
      tenantId: 'tenant-1',
      deletedAt: new Date('2026-08-01T00:00:00.000Z'),
    } as never);

    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects requests without a buildingId', async () => {
    await expect(
      guard.canActivate(
        createContext({
          params: {},
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects users without a tenant membership role for the building', async () => {
    jest.spyOn(prisma.building, 'findFirst').mockResolvedValue({
      id: 'building-1',
      tenantId: 'tenant-1',
      deletedAt: null,
    } as never);
    jest.spyOn(prisma.membership, 'findUnique').mockResolvedValue({
      roles: [],
    } as never);

    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(ForbiddenException);
  });
});
