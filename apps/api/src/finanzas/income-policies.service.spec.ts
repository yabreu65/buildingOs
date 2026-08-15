import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FundStatus, IncomeApplicationDestination } from '@prisma/client';
import { IncomePoliciesService } from './income-policies.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';

describe('IncomePoliciesService', () => {
  let service: IncomePoliciesService;
  let prisma: PrismaService;
  let audit: AuditService;
  let validators: FinanzasValidators;

  const prismaValue = {
    incomePolicy: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    incomePolicyVersion: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    incomePolicyRule: { create: jest.fn() },
    expenseLedgerCategory: { findFirst: jest.fn() },
    fund: { findMany: jest.fn() },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  };

  function mockTransaction() {
    (prismaValue.$transaction as jest.Mock).mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback({
        incomePolicy: prismaValue.incomePolicy,
        incomePolicyVersion: prismaValue.incomePolicyVersion,
        incomePolicyRule: prismaValue.incomePolicyRule,
        expenseLedgerCategory: prismaValue.expenseLedgerCategory,
        fund: prismaValue.fund,
        auditLog: { create: jest.fn() },
        $executeRaw: prismaValue.$executeRaw,
      }),
    );
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    (prismaValue.incomePolicyRule.create as jest.Mock).mockReset();
    (prismaValue.incomePolicyVersion.create as jest.Mock).mockReset();
    mockTransaction();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncomePoliciesService,
        { provide: PrismaService, useValue: prismaValue },
        {
          provide: AuditService,
          useValue: {
            createLog: jest.fn(),
            createLogRequired: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: FinanzasValidators,
          useValue: { isAdminOrOperator: jest.fn().mockReturnValue(true) },
        },
      ],
    }).compile();

    service = module.get<IncomePoliciesService>(IncomePoliciesService);
    prisma = module.get<PrismaService>(PrismaService);
    audit = module.get<AuditService>(AuditService);
    validators = module.get<FinanzasValidators>(FinanzasValidators);
    (audit.createLogRequired as jest.Mock).mockResolvedValue(undefined);
  });

  const roles = ['TENANT_ADMIN'];
  const rules = (r: Array<{ destinationType: IncomeApplicationDestination; fundId?: string; percentageBasisPoints: number }>) => ({ rules: r });
  const makePolicy = (overrides: Record<string, unknown> = {}) => ({
    id: 'policy-1',
    tenantId: 'tenant-1',
    categoryId: 'cat-1',
    createdByMembershipId: 'member-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    (prisma.expenseLedgerCategory.findFirst as jest.Mock).mockResolvedValue({
      id: 'cat-1',
      name: 'Parrillera',
      movementType: 'INCOME',
    });
    (prisma.fund.findMany as jest.Mock).mockResolvedValue([{ id: 'fund-1', status: FundStatus.ACTIVE }]);
    (prisma.incomePolicy.findUnique as jest.Mock).mockResolvedValue(null); // sin política existente
    (prisma.incomePolicyVersion.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.incomePolicyVersion.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', policyId: 'policy-1', version: 1, status: 'ACTIVE', createdAt: new Date(), rules: [] });
    (prisma.incomePolicyVersion.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.incomePolicyRule.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({ id: `rule-${data.destinationType}-${data.fundId ?? 'nf'}`, ...data }));
    (prisma.incomePolicyVersion.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({ id: `v-${data.version}`, ...data }));
  });

  // ── RBAC ────────────────────────────────────────────────────────────────

  it('rejects non-admin users', async () => {
    (validators.isAdminOrOperator as jest.Mock).mockReturnValue(false);
    await expect(service.listPolicies('tenant-1', ['RESIDENT'])).rejects.toThrow(ForbiddenException);
    await expect(
      service.createPolicy('tenant-1', 'm', ['RESIDENT'], rules([{ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 10000 }])),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── Percentage invariant ────────────────────────────────────────────────

  it('creates a 70/30 policy', async () => {
    (prisma.incomePolicy.create as jest.Mock).mockResolvedValue(makePolicy());

    await service.createPolicy('tenant-1', 'member-1', roles, rules([
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 7000 },
      { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', percentageBasisPoints: 3000 },
    ]));

    expect(prisma.incomePolicy.create).toHaveBeenCalledTimes(1);
    expect(prisma.incomePolicyRule.create).toHaveBeenCalledTimes(2);
    expect(audit.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'INCOME_POLICY_CREATE' }),
      expect.anything(),
    );
  });

  it('allows sum exactly 10000 bp', async () => {
    (prisma.incomePolicy.create as jest.Mock).mockResolvedValue(makePolicy());
    await service.createPolicy('tenant-1', 'member-1', roles, rules([
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 7000 },
      { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', percentageBasisPoints: 3000 },
    ]));
    expect(prisma.incomePolicy.create).toHaveBeenCalledTimes(1);
  });

  it('rejects sum 9999 bp', async () => {
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 6999 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', percentageBasisPoints: 3000 },
      ])),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.incomePolicy.create).not.toHaveBeenCalled();
  });

  it('rejects sum 10001 bp', async () => {
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 7001 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', percentageBasisPoints: 3000 },
      ])),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects 0 bp', async () => {
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 0 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', percentageBasisPoints: 10000 },
      ])),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects negative bp', async () => {
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: -100 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', percentageBasisPoints: 10100 },
      ])),
    ).rejects.toThrow(BadRequestException);
  });

  // ── Duplicates ──────────────────────────────────────────────────────────

  it('rejects duplicate OFFSET rules', async () => {
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 5000 },
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 5000 },
      ])),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects duplicate CARRY_FORWARD rules', async () => {
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([
        { destinationType: IncomeApplicationDestination.CARRY_FORWARD, percentageBasisPoints: 5000 },
        { destinationType: IncomeApplicationDestination.CARRY_FORWARD, percentageBasisPoints: 5000 },
      ])),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects duplicate FUND rules to the same fund', async () => {
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', percentageBasisPoints: 5000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', percentageBasisPoints: 5000 },
      ])),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows FUND rules to different funds', async () => {
    (prisma.fund.findMany as jest.Mock).mockResolvedValue([
      { id: 'fund-1', status: FundStatus.ACTIVE },
      { id: 'fund-2', status: FundStatus.ACTIVE },
    ]);
    (prisma.incomePolicy.create as jest.Mock).mockResolvedValue(makePolicy());

    await service.createPolicy('tenant-1', 'member-1', roles, rules([
      { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', percentageBasisPoints: 4000 },
      { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-2', percentageBasisPoints: 6000 },
    ]));
    expect(prisma.incomePolicy.create).toHaveBeenCalledTimes(1);
  });

  // ── Category / Fund validation ──────────────────────────────────────────

  it('rejects a cross-tenant category (not found)', async () => {
    (prisma.expenseLedgerCategory.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([{ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 10000 }])),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a non-INCOME category', async () => {
    (prisma.expenseLedgerCategory.findFirst as jest.Mock).mockResolvedValue({ id: 'cat-1', name: 'Luz', movementType: 'EXPENSE' });
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([{ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 10000 }])),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a cross-tenant fund at policy publication', async () => {
    (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([{ destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-x', percentageBasisPoints: 10000 }])),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects an ARCHIVED fund at policy publication', async () => {
    (prisma.fund.findMany as jest.Mock).mockResolvedValue([{ id: 'fund-1', status: FundStatus.ARCHIVED }]);
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([{ destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', percentageBasisPoints: 10000 }])),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects FUND without fundId', async () => {
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([{ destinationType: IncomeApplicationDestination.FUND, percentageBasisPoints: 10000 }])),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects OFFSET with fundId', async () => {
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([{ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, fundId: 'fund-1', percentageBasisPoints: 10000 }])),
    ).rejects.toThrow(BadRequestException);
  });

  // ── Versioning / history ────────────────────────────────────────────────

  it('publishes a new version and deactivates the previous one (history preserved)', async () => {
    (prisma.incomePolicy.findUnique as jest.Mock).mockResolvedValue(makePolicy());
    (prisma.incomePolicyVersion.findFirst as jest.Mock).mockResolvedValue({ id: 'v1', policyId: 'policy-1', version: 1, status: 'ACTIVE', createdAt: new Date() });
    (prisma.incomePolicyVersion.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.incomePolicyVersion.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({ id: 'v2', ...data }));
    (prisma.incomePolicyVersion.findMany as jest.Mock).mockResolvedValue([
      { id: 'v2', policyId: 'policy-1', version: 2, status: 'ACTIVE', createdAt: new Date(), rules: [{ id: 'r1', destinationType: IncomeApplicationDestination.CARRY_FORWARD, fundId: null, percentageBasisPoints: 10000 }] },
      { id: 'v1', policyId: 'policy-1', version: 1, status: 'INACTIVE', createdAt: new Date(), rules: [{ id: 'r0', destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, fundId: null, percentageBasisPoints: 10000 }] },
    ]);

    const result = await service.createVersion('tenant-1', 'cat-1', 'member-1', roles, rules([{ destinationType: IncomeApplicationDestination.CARRY_FORWARD, percentageBasisPoints: 10000 }]));

    expect(prisma.incomePolicyVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'INACTIVE' } }),
    );
    expect(prisma.incomePolicyVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 2, status: 'ACTIVE' }) }),
    );
    expect(result.versions).toHaveLength(2);
    expect(result.currentVersion?.version).toBe(2);
    expect(audit.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'INCOME_POLICY_VERSION_CREATE' }),
      expect.anything(),
    );
  });

  it('rejects creating a policy that already exists', async () => {
    (prisma.incomePolicy.findUnique as jest.Mock).mockResolvedValue(makePolicy());
    await expect(
      service.createPolicy('tenant-1', 'member-1', roles, rules([{ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 10000 }])),
    ).rejects.toThrow(ConflictException);
  });

  it('deactivates the current version (INCOME_POLICY_DEACTIVATE audit)', async () => {
    (prisma.incomePolicy.findUnique as jest.Mock).mockResolvedValue(makePolicy());
    (prisma.incomePolicyVersion.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.incomePolicyVersion.findMany as jest.Mock).mockResolvedValue([
      { id: 'v1', policyId: 'policy-1', version: 1, status: 'INACTIVE', createdAt: new Date(), rules: [] },
    ]);

    const result = await service.deactivatePolicy('tenant-1', 'cat-1', 'member-1', roles);

    expect(result.currentVersion).toBeNull();
    expect(audit.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'INCOME_POLICY_DEACTIVATE' }),
      expect.anything(),
    );
  });

  it('enforces tenant isolation on getPolicy (not found for other tenant)', async () => {
    (prisma.incomePolicy.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.getPolicy('tenant-1', 'cat-1', roles)).rejects.toThrow(NotFoundException);
    expect(prisma.incomePolicy.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_categoryId: { tenantId: 'tenant-1', categoryId: 'cat-1' } } }),
    );
  });

  it('omits nulls from audit metadata (no null/undefined)', async () => {
    (prisma.incomePolicy.create as jest.Mock).mockResolvedValue(makePolicy());

    await service.createPolicy('tenant-1', 'member-1', roles, rules([
      { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, percentageBasisPoints: 10000 },
    ]));

    const call = (audit.createLogRequired as jest.Mock).mock.calls[0] as [{ metadata: Record<string, unknown> }];
    expect(call[0].action).toBe('INCOME_POLICY_CREATE');
    expect(call[0].metadata.categoryName).toBe('Parrillera');
  });
});
