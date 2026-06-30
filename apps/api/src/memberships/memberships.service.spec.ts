import { Test, TestingModule } from '@nestjs/testing';
import { MembershipsService } from './memberships.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('MembershipsService', () => {
  let service: MembershipsService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        {
          provide: PrismaService,
          useValue: {
            membership: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: AuditService,
          useValue: {
            createLog: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MembershipsService>(MembershipsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAssignableTicketMembers', () => {
    it('filters out resident-only memberships and keeps operational members', async () => {
      jest.spyOn(prismaService.membership, 'findMany').mockResolvedValue([
        {
          id: 'membership-resident',
          userId: 'user-resident',
          user: { id: 'user-resident', name: 'Resident User', email: 'resident@demo.local' },
          roles: [{ role: 'RESIDENT' }],
        },
        {
          id: 'membership-operator',
          userId: 'user-operator',
          user: { id: 'user-operator', name: 'Operator User', email: 'operator@demo.local' },
          roles: [{ role: 'OPERATOR' }],
        },
        {
          id: 'membership-admin',
          userId: 'user-admin',
          user: { id: 'user-admin', name: 'Admin User', email: 'admin@demo.local' },
          roles: [{ role: 'TENANT_ADMIN' }],
        },
      ] as any);

      const result = await service.getAssignableTicketMembers('tenant-123');

      expect(prismaService.membership.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-123',
          roles: {
            some: {
              role: { in: ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'] },
            },
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          roles: {
            select: {
              role: true,
            },
          },
        },
      });

      expect(result).toEqual([
        {
          id: 'user-admin',
          membershipId: 'membership-admin',
          name: 'Admin User',
          email: 'admin@demo.local',
          roles: ['TENANT_ADMIN'],
        },
        {
          id: 'user-operator',
          membershipId: 'membership-operator',
          name: 'Operator User',
          email: 'operator@demo.local',
          roles: ['OPERATOR'],
        },
      ]);
    });
  });
});
