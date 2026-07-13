import { ArgumentMetadata, BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditAction } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditController, type RequestWithUser } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

describe('AuditController', () => {
  let controller: AuditController;
  let auditService: {
    queryLogs: jest.Mock;
    queryTenantLogs: jest.Mock;
    queryGlobalLogsForSuperAdmin: jest.Mock;
  };

  beforeEach(async () => {
    auditService = {
      queryLogs: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      queryTenantLogs: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      queryGlobalLogsForSuperAdmin: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    };

    const module = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        {
          provide: AuditService,
          useValue: auditService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .compile();

    controller = module.get(AuditController);
  });

  it('uses the requested tenant membership without flattening roles across memberships', async () => {
    const req = buildRequest([
      { id: 'member-a', tenantId: 'tenant-a', roles: ['RESIDENT'] },
      { id: 'member-b', tenantId: 'tenant-b', roles: ['TENANT_ADMIN'] },
    ]);

    const query = await validateQuery({
      tenantId: ' tenant-b ',
      actorUserId: 'user-2',
      entityType: 'Liquidation',
      action: AuditAction.LIQUIDATION_PUBLISH,
      dateFrom: '2026-07-01T00:00:00.000Z',
      dateTo: '2026-07-02T00:00:00.000Z',
      page: 2,
      limit: 25,
    });

    await expect(controller.getLogs(req, query)).resolves.toEqual({
      data: [],
      total: 0,
      pagination: {
        page: 2,
        limit: 25,
        skip: 25,
        take: 25,
        total: 0,
      },
    });

    expect(auditService.queryTenantLogs).toHaveBeenCalledWith('tenant-b', 'member-b', {
      actorUserId: 'user-2',
      action: AuditAction.LIQUIDATION_PUBLISH,
      entityType: 'Liquidation',
      dateFrom: new Date('2026-07-01T00:00:00.000Z'),
      dateTo: new Date('2026-07-02T00:00:00.000Z'),
      skip: 25,
      take: 25,
    });
  });

  it('rejects a tenantId that is not backed by an audit-eligible membership', async () => {
    const req = buildRequest([
      { id: 'member-a', tenantId: 'tenant-a', roles: ['TENANT_ADMIN'] },
    ]);
    const query = await validateQuery({ tenantId: 'tenant-b' });

    await expect(controller.getLogs(req, query)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(auditService.queryTenantLogs).not.toHaveBeenCalled();
  });

  it('uses the only eligible tenant when tenantId is omitted', async () => {
    const req = buildRequest([
      { id: 'member-a', tenantId: 'tenant-a', roles: ['RESIDENT'] },
      { id: 'member-b', tenantId: 'tenant-b', roles: ['TENANT_OWNER'] },
    ]);
    const query = await validateQuery({ page: 1, limit: 10 });

    await controller.getLogs(req, query);

    expect(auditService.queryTenantLogs).toHaveBeenCalledWith('tenant-b', 'member-b', {
      actorUserId: undefined,
      action: undefined,
      entityType: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      skip: 0,
      take: 10,
    });
  });

  it('uses the request tenant context when it is already defined', async () => {
    const req = buildRequest(
      [
        { id: 'member-a', tenantId: 'tenant-a', roles: ['TENANT_ADMIN'] },
        { id: 'member-b', tenantId: 'tenant-b', roles: ['TENANT_OWNER'] },
      ],
      'tenant-b',
    );
    const query = await validateQuery({ limit: 15 });

    await controller.getLogs(req, query);

    expect(auditService.queryTenantLogs).toHaveBeenCalledWith('tenant-b', 'member-b', {
      actorUserId: undefined,
      action: undefined,
      entityType: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      skip: 0,
      take: 15,
    });
  });

  it('rejects ambiguous tenant scope when tenantId is omitted', async () => {
    const req = buildRequest([
      { id: 'member-a', tenantId: 'tenant-a', roles: ['TENANT_ADMIN'] },
      { id: 'member-b', tenantId: 'tenant-b', roles: ['TENANT_OWNER'] },
    ]);
    const query = await validateQuery({ limit: 20 });

    await expect(controller.getLogs(req, query)).rejects.toThrow(
      BadRequestException,
    );
    expect(auditService.queryTenantLogs).not.toHaveBeenCalled();
  });

  it('rejects resident-only memberships from tenant-scoped audit access', async () => {
    const req = buildRequest([
      { id: 'member-a', tenantId: 'tenant-a', roles: ['RESIDENT'] },
    ]);
    const query = await validateQuery({ tenantId: 'tenant-a' });

    await expect(controller.getLogs(req, query)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(auditService.queryTenantLogs).not.toHaveBeenCalled();
  });

  it.each([
    { body: { tenantId: 'tenant-a', page: 'abc' } },
    { body: { tenantId: 'tenant-a', limit: -1 } },
    { body: { tenantId: 'tenant-a', limit: 101 } },
    { body: { tenantId: 'tenant-a', action: 'NOT_REAL' } },
    { body: { tenantId: 'tenant-a', dateFrom: 'not-a-date' } },
  ])('rejects invalid audit query parameters', async ({ body }) => {
    await expect(validateQuery(body)).rejects.toMatchObject({
      status: 400,
    });
  });

  async function validateQuery(body: unknown): Promise<AuditLogQueryDto> {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });

    const metadata: ArgumentMetadata = {
      type: 'query',
      metatype: AuditLogQueryDto,
      data: undefined,
    };

    return pipe.transform(body, metadata) as Promise<AuditLogQueryDto>;
  }

  function buildRequest(
    memberships: RequestWithUser['user']['memberships'],
    tenantId?: string,
  ): RequestWithUser {
    return {
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        tenantId,
        membershipId: memberships[0]?.id,
        memberships,
      },
    } as RequestWithUser;
  }
});
