import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: {
    auditLog: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get(AuditService);
  });

  it('requires a tenantId for tenant-scoped queries', async () => {
    await expect(service.queryLogs('')).rejects.toThrow(BadRequestException);
  });

  it('trims the tenantId before querying audit logs', async () => {
    await service.queryLogs('  tenant-a  ');

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-a' },
      }),
    );
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
    });
  });

  it('always scopes audit queries to the requested tenant', async () => {
    await service.queryLogs('tenant-a', {
      actorUserId: 'user-1',
      action: AuditAction.LIQUIDATION_PUBLISH,
      entityType: 'Liquidation',
      skip: 5,
      take: 10,
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        actorUserId: 'user-1',
        action: AuditAction.LIQUIDATION_PUBLISH,
        entity: 'Liquidation',
      },
      orderBy: { createdAt: 'desc' },
      skip: 5,
      take: 10,
      include: {
        tenant: { select: { id: true, name: true } },
        actor: { select: { id: true, email: true, name: true } },
      },
    });
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        actorUserId: 'user-1',
        action: AuditAction.LIQUIDATION_PUBLISH,
        entity: 'Liquidation',
      },
    });
  });

  it('keeps tenant isolation even when filters are empty', async () => {
    await service.queryLogs('tenant-b');

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-b' },
      }),
    );
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-b' },
    });
  });

  it('rejects invalid query dates before querying audit logs', async () => {
    await expect(
      service.queryLogs('tenant-a', {
        dateFrom: new Date('invalid'),
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.count).not.toHaveBeenCalled();
  });

  it('writes transactional audit logs with the provided transaction client', async () => {
    const tx = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    await service.createLogRequired(
      {
        tenantId: 'tenant-a',
        actorMembershipId: 'member-1',
        action: 'LIQUIDATION_REVIEW',
        entityType: 'Liquidation',
        entityId: 'liq-1',
      },
      tx as never,
    );

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-a',
        actorUserId: null,
        actorMembershipId: 'member-1',
        action: 'LIQUIDATION_REVIEW',
        entity: 'Liquidation',
        entityId: 'liq-1',
        metadata: {},
      },
    });
  });

  it('persists JSON metadata values without unsafe casts', async () => {
    const tx = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    await service.createLogRequired(
      {
        tenantId: 'tenant-a',
        actorMembershipId: 'member-1',
        action: 'LIQUIDATION_PUBLISH',
        entityType: 'Liquidation',
        entityId: 'liq-1',
        metadata: {
          count: 2,
          flags: ['a', 'b'],
          nested: {
            ok: true,
            note: 'ok',
          },
        },
      },
      tx as never,
    );

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-a',
        actorMembershipId: 'member-1',
        entityId: 'liq-1',
        metadata: expect.objectContaining({
          count: 2,
          flags: ['a', 'b'],
          nested: expect.objectContaining({
            ok: true,
            note: 'ok',
          }),
        }),
      }),
    });
  });

  it.each([
    ['primitive metadata', 'hello'],
    ['array metadata', ['one', 2, true, false]],
  ])('accepts %s when metadata is JSON compatible', async (_label, metadata) => {
    const tx = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    await service.createLogRequired(
      {
        tenantId: 'tenant-a',
        actorMembershipId: 'member-1',
        action: 'LIQUIDATION_PUBLISH',
        entityType: 'Liquidation',
        entityId: 'liq-1',
        metadata,
      },
      tx as never,
    );

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata,
      }),
    });
  });

  it('rejects null metadata values', async () => {
    const tx = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    await expect(
      service.createLogRequired(
        {
          tenantId: 'tenant-a',
          actorMembershipId: 'member-1',
          action: 'LIQUIDATION_PUBLISH',
          entityType: 'Liquidation',
          entityId: 'liq-1',
          metadata: null,
        },
        tx as never,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects non-finite numeric metadata values', async () => {
    const tx = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    await expect(
      service.createLogRequired(
        {
          tenantId: 'tenant-a',
          actorMembershipId: 'member-1',
          action: 'LIQUIDATION_PUBLISH',
          entityType: 'Liquidation',
          entityId: 'liq-1',
          metadata: Number.NaN,
        },
        tx as never,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined property', { foo: undefined }],
    ['date value', new Date('2026-05-01T00:00:00.000Z')],
    ['bigint value', BigInt(1)],
    ['symbol value', Symbol('audit')],
    ['function value', () => undefined],
    ['class instance', new (class AuditPayload {
      value = 'x';
    })()],
  ])('rejects %s in audit metadata', async (_label, metadata) => {
    const tx = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    await expect(
      service.createLogRequired(
        {
          tenantId: 'tenant-a',
          actorMembershipId: 'member-1',
          action: 'LIQUIDATION_PUBLISH',
          entityType: 'Liquidation',
          entityId: 'liq-1',
          metadata,
        },
        tx as never,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects circular audit metadata before writing', async () => {
    const metadata: Record<string, unknown> = { self: null };
    metadata.self = metadata;
    const tx = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    await expect(
      service.createLogRequired(
        {
          tenantId: 'tenant-a',
          actorMembershipId: 'member-1',
          action: 'LIQUIDATION_PUBLISH',
          entityType: 'Liquidation',
          entityId: 'liq-1',
          metadata,
        },
        tx as never,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('keeps createLog fire-and-forget when metadata is invalid', async () => {
    await expect(
      service.createLog({
        tenantId: 'tenant-a',
        actorMembershipId: 'member-1',
        action: 'LIQUIDATION_PUBLISH',
        entityType: 'Liquidation',
        entityId: 'liq-1',
        metadata: new Date('2026-05-01T00:00:00.000Z'),
      }),
    ).resolves.toBeUndefined();

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
