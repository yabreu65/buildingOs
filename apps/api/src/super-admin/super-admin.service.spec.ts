import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, TenantType } from '@prisma/client';
import { SuperAdminService } from './super-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExpenseLedgerSeedService } from '../expense-seed/expense-seed.service';

describe('SuperAdminService', () => {
  let service: SuperAdminService;

  const mockPrisma = {
    tenant: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockAuditService = {
    createLog: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const mockExpenseLedgerSeedService = {
    seedDefaultCategoriesForTenant: jest.fn(),
  };

  const buildTenant = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'tenant-1',
    name: 'Tenant Uno',
    type: TenantType.ADMINISTRADORA,
    isDemo: false,
    createdAt: new Date('2026-06-17T00:00:00Z'),
    updatedAt: new Date('2026-06-17T00:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuperAdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ExpenseLedgerSeedService, useValue: mockExpenseLedgerSeedService },
      ],
    }).compile();

    service = module.get<SuperAdminService>(SuperAdminService);
  });

  it('exposes isDemo in listTenants and getTenant', async () => {
    const demoTenant = buildTenant({ id: 'tenant-demo', name: 'Tenant Demo', isDemo: true });

    mockPrisma.tenant.findMany.mockResolvedValue([demoTenant]);
    mockPrisma.tenant.count.mockResolvedValue(1);
    mockPrisma.tenant.findUnique.mockResolvedValue(demoTenant);

    const listResult = await service.listTenants();
    const getResult = await service.getTenant('tenant-demo');

    expect(listResult.data[0]).toMatchObject({
      id: 'tenant-demo',
      name: 'Tenant Demo',
      isDemo: true,
    });
    expect(getResult).toMatchObject({
      id: 'tenant-demo',
      name: 'Tenant Demo',
      isDemo: true,
    });
  });

  it('allows delete for demo tenants', async () => {
    const demoTenant = buildTenant({ id: 'tenant-demo', isDemo: true });

    mockPrisma.tenant.findUnique.mockResolvedValue(demoTenant);
    mockPrisma.tenant.delete.mockResolvedValue(demoTenant);
    mockAuditService.createLog.mockResolvedValue(undefined);

    await expect(service.deleteTenant('tenant-demo', 'actor-1')).resolves.toBeUndefined();

    expect(mockPrisma.tenant.delete).toHaveBeenCalledWith({ where: { id: 'tenant-demo' } });
    expect(mockAuditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-demo',
        actorUserId: 'actor-1',
        action: AuditAction.TENANT_DELETE,
      }),
    );
  });

  it('blocks delete for real tenants with ForbiddenException', async () => {
    const realTenant = buildTenant({ id: 'tenant-real', isDemo: false });

    mockPrisma.tenant.findUnique.mockResolvedValue(realTenant);

    const result = service.deleteTenant('tenant-real', 'actor-1');

    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    await expect(result).rejects.toThrow(
      'Este cliente es real y no puede eliminarse físicamente. Archívalo o suspéndelo cuando esa opción esté disponible.',
    );

    expect(mockPrisma.tenant.delete).not.toHaveBeenCalled();
  });
});
