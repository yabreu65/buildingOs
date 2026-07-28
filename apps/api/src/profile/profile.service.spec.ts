import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction, MemberStatus, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedRequest } from '../common/types/request.types';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

describe('ProfileService', () => {
  let service: ProfileService;
  let prisma: {
    tenantMember: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let auditService: {
    createLog: jest.Mock;
  };

  const now = new Date('2026-07-27T12:00:00.000Z');
  const authEmail = 'resident.auth@example.com';
  const tenantMemberEmail = 'tenant.member@example.com';

  const baseMember = {
    id: 'member-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    disabledAt: null,
    name: 'Resident One',
    email: tenantMemberEmail,
    phone: '+584141234567',
    role: Role.RESIDENT,
    status: MemberStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
  } as const;

  const residentMembership = {
    id: 'membership-1',
    tenantId: 'tenant-1',
    roles: [Role.RESIDENT],
  };

  const makeRequest = (overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest => ({
    headers: {},
    user: {
      id: 'user-1',
      email: 'resident.auth@example.com',
      name: 'Resident One',
      memberships: [residentMembership],
    },
    tenantId: 'tenant-1',
    ...overrides,
  } as AuthenticatedRequest);

  beforeEach(async () => {
    prisma = {
      tenantMember: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    auditService = {
      createLog: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: AuditService,
          useValue: auditService,
        },
      ],
    }).compile();

    service = module.get(ProfileService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns the authenticated tenant member profile without leaking private fields', async () => {
    prisma.tenantMember.findFirst.mockResolvedValue(baseMember);

    const profile = await service.getMyProfile(makeRequest());

    expect(prisma.tenantMember.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        disabledAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        disabledAt: true,
        name: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(profile).toEqual({
      id: 'member-1',
      tenantId: 'tenant-1',
      name: 'Resident One',
      email: 'resident.auth@example.com',
      phone: '+584141234567',
      role: Role.RESIDENT,
      status: MemberStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
    expect(profile).not.toHaveProperty('userId');
    expect(profile).not.toHaveProperty('disabledAt');
    expect(profile).not.toHaveProperty('notes');
  });

  it('throws when tenant context is missing', async () => {
    await expect(
      service.getMyProfile(makeRequest({ tenantId: undefined, headers: {} })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when the authenticated user has no tenant member record', async () => {
    prisma.tenantMember.findFirst.mockResolvedValue(null);

    await expect(service.getMyProfile(makeRequest())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when the authenticated user email is missing', async () => {
    await expect(
      service.getMyProfile(
        makeRequest({
          user: {
            id: 'user-1',
            email: '',
            name: 'Resident One',
            memberships: [residentMembership],
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
    expect(auditService.createLog).not.toHaveBeenCalled();
  });

  it('allows access when the requested tenant has a resident membership', async () => {
    prisma.tenantMember.findFirst.mockResolvedValue(baseMember);

    await service.getMyProfile(makeRequest());

    expect(prisma.tenantMember.findFirst).toHaveBeenCalledTimes(1);
  });

  it('allows access when the tenant membership includes resident plus admin roles', async () => {
    prisma.tenantMember.findFirst.mockResolvedValue(baseMember);

    const profile = await service.getMyProfile(
      makeRequest({
        user: {
          id: 'user-1',
          email: 'resident.auth@example.com',
          name: 'Resident One',
          memberships: [
            {
              id: 'membership-1',
              tenantId: 'tenant-1',
              roles: [Role.RESIDENT, Role.TENANT_ADMIN],
            },
          ],
        },
      }),
    );

    expect(profile.id).toBe('member-1');
  });

  it('rejects when the membership belongs to another tenant', async () => {
    await expect(
      service.getMyProfile(
        makeRequest({
          tenantId: 'tenant-2',
          user: {
            id: 'user-1',
            email: 'resident.auth@example.com',
            name: 'Resident One',
            memberships: [
              {
                id: 'membership-1',
                tenantId: 'tenant-1',
                roles: [Role.RESIDENT],
              },
            ],
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
    expect(auditService.createLog).not.toHaveBeenCalled();
  });

  it('rejects when the user has no membership records', async () => {
    await expect(
      service.getMyProfile(
        makeRequest({
          user: {
            id: 'user-1',
            email: 'resident.auth@example.com',
            name: 'Resident One',
            memberships: [],
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
  });

  it('rejects when the tenant membership does not include resident', async () => {
    await expect(
      service.getMyProfile(
        makeRequest({
          user: {
            id: 'user-1',
            email: 'resident.auth@example.com',
            name: 'Resident One',
            memberships: [
              {
                id: 'membership-1',
                tenantId: 'tenant-1',
                roles: [Role.TENANT_ADMIN],
              },
            ],
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
  });

  it('updates only name and phone, normalizes trimmed values, and writes a safe audit log', async () => {
    prisma.tenantMember.findFirst
      .mockResolvedValueOnce(baseMember)
      .mockResolvedValueOnce(null);
    prisma.tenantMember.update.mockResolvedValue({
      ...baseMember,
      name: 'Resident Prime',
      phone: '+584141111111',
      updatedAt: new Date('2026-07-27T12:30:00.000Z'),
    });

    const profile = await service.updateMyProfile(makeRequest(), {
      name: '  Resident Prime  ',
      phone: ' +584141111111 ',
    } as UpdateProfileDto);

    expect(prisma.tenantMember.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        disabledAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        disabledAt: true,
        name: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(prisma.tenantMember.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        tenantId: 'tenant-1',
        phone: '+584141111111',
        id: { not: 'member-1' },
      },
      select: { id: true },
    });
    expect(prisma.tenantMember.update).toHaveBeenCalledWith({
      where: { id: 'member-1' },
      data: {
        name: 'Resident Prime',
        phone: '+584141111111',
      },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        disabledAt: true,
        name: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(auditService.createLog).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      action: AuditAction.TENANT_MEMBER_UPDATE,
      entityType: 'TenantMember',
      entityId: 'member-1',
      metadata: {
        changedFields: ['name', 'phone'],
      },
    });
    expect(profile).toEqual({
      id: 'member-1',
      tenantId: 'tenant-1',
      name: 'Resident Prime',
      email: 'resident.auth@example.com',
      phone: '+584141111111',
      role: Role.RESIDENT,
      status: MemberStatus.ACTIVE,
      createdAt: now,
      updatedAt: new Date('2026-07-27T12:30:00.000Z'),
    });
  });

  it('allows updating when the tenant membership includes mixed resident roles', async () => {
    prisma.tenantMember.findFirst
      .mockResolvedValueOnce(baseMember)
      .mockResolvedValueOnce(null);
    prisma.tenantMember.update.mockResolvedValue({
      ...baseMember,
      name: 'Resident Prime',
      updatedAt: new Date('2026-07-27T12:30:00.000Z'),
    });

    await service.updateMyProfile(
      makeRequest({
        user: {
          id: 'user-1',
          email: 'resident.auth@example.com',
          name: 'Resident One',
          memberships: [
            {
              id: 'membership-1',
              tenantId: 'tenant-1',
              roles: [Role.RESIDENT, Role.OPERATOR],
            },
          ],
        },
      }),
      {
        name: 'Resident Prime',
      } as UpdateProfileDto,
    );

    expect(prisma.tenantMember.update).toHaveBeenCalledTimes(1);
  });

  it('normalizes an empty phone string to null and keeps private fields hidden', async () => {
    prisma.tenantMember.findFirst.mockResolvedValue(baseMember);
    prisma.tenantMember.update.mockResolvedValue({
      ...baseMember,
      phone: null,
      updatedAt: new Date('2026-07-27T12:45:00.000Z'),
    });

    const profile = await service.updateMyProfile(makeRequest(), {
      phone: '',
    } as UpdateProfileDto);

    expect(prisma.tenantMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          phone: null,
        },
      }),
    );
    expect(profile.phone).toBeNull();
    expect(profile).not.toHaveProperty('userId');
  });

  it('returns the authenticated email on update even when the tenant member email differs', async () => {
    prisma.tenantMember.findFirst.mockResolvedValue(baseMember);
    prisma.tenantMember.update.mockResolvedValue({
      ...baseMember,
      name: 'Resident Prime',
      updatedAt: new Date('2026-07-27T12:45:00.000Z'),
    });

    const profile = await service.updateMyProfile(makeRequest(), {
      name: 'Resident Prime',
    } as UpdateProfileDto);

    expect(profile.email).toBe(authEmail);
    expect(profile.email).not.toBe(tenantMemberEmail);
  });

  it('returns the current profile without updating when no effective changes are provided', async () => {
    prisma.tenantMember.findFirst.mockResolvedValue(baseMember);

    const profile = await service.updateMyProfile(makeRequest(), {
      name: 'Resident One',
      phone: '+584141234567',
    } as UpdateProfileDto);

    expect(prisma.tenantMember.update).not.toHaveBeenCalled();
    expect(auditService.createLog).not.toHaveBeenCalled();
    expect(profile).toEqual({
      id: 'member-1',
      tenantId: 'tenant-1',
      name: 'Resident One',
      email: 'resident.auth@example.com',
      phone: '+584141234567',
      role: Role.RESIDENT,
      status: MemberStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
  });

  it('rejects duplicate phones inside the same tenant', async () => {
    prisma.tenantMember.findFirst
      .mockResolvedValueOnce(baseMember)
      .mockResolvedValueOnce({ id: 'member-2' });

    await expect(
      service.updateMyProfile(makeRequest(), {
        phone: '+584141999999',
      } as UpdateProfileDto),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.tenantMember.update).not.toHaveBeenCalled();
    expect(auditService.createLog).not.toHaveBeenCalled();
  });

  it('rejects update attempts when membership validation fails before tenant member lookup', async () => {
    await expect(
      service.updateMyProfile(
        makeRequest({
          user: {
            id: 'user-1',
            email: 'resident.auth@example.com',
            name: 'Resident One',
            memberships: [
              {
                id: 'membership-1',
                tenantId: 'tenant-1',
                roles: [Role.OPERATOR],
              },
            ],
          },
        }),
        {
          name: 'Resident Prime',
        } as UpdateProfileDto,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.tenantMember.update).not.toHaveBeenCalled();
    expect(auditService.createLog).not.toHaveBeenCalled();
  });

  it('rejects reading tenant B when authenticated membership belongs to tenant A', async () => {
    await expect(
      service.getMyProfile(
        makeRequest({
          tenantId: 'tenant-b',
          user: {
            id: 'user-1',
            email: 'resident.auth@example.com',
            name: 'Resident One',
            memberships: [
              {
                id: 'membership-1',
                tenantId: 'tenant-a',
                roles: [Role.RESIDENT],
              },
            ],
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
  });

  it('rejects updating tenant B when authenticated membership belongs to tenant A', async () => {
    await expect(
      service.updateMyProfile(
        makeRequest({
          tenantId: 'tenant-b',
          user: {
            id: 'user-1',
            email: 'resident.auth@example.com',
            name: 'Resident One',
            memberships: [
              {
                id: 'membership-1',
                tenantId: 'tenant-a',
                roles: [Role.RESIDENT],
              },
            ],
          },
        }),
        {
          name: 'Resident Prime',
        } as UpdateProfileDto,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.tenantMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.tenantMember.update).not.toHaveBeenCalled();
    expect(auditService.createLog).not.toHaveBeenCalled();
  });

  it('does not expose disabled members as the active profile', async () => {
    prisma.tenantMember.findFirst.mockResolvedValue(null);

    await expect(service.getMyProfile(makeRequest())).rejects.toBeInstanceOf(NotFoundException);
  });
});
