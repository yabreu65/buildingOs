import { ConflictException } from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  Role,
  ScopeType,
  TenantType,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FinanzasValidators } from './finanzas.validators';
import { LiquidationsService } from './liquidations.service';
import {
  createLiquidationWorkflowDependencies,
  createLiquidationDraftRecord,
  LiquidationPublicationUseCase,
  reviewLiquidationRecord,
  type LiquidationWorkflowDependencies,
} from './liquidation-publication.use-case';
import { ensureSeedPublishedLiquidation } from '../../prisma/lib/seed-liquidation-workflow';

const describePostgresIntegration =
  process.env.RUN_POSTGRES_INTEGRATION === '1' ? describe : describe.skip;

describePostgresIntegration('Liquidation publication PostgreSQL integration', () => {
  const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
  let prisma: PrismaClient;
  let auditService: AuditService;
  let validators: FinanzasValidators;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
    }

    prisma = new PrismaClient();
    await prisma.$connect();
    auditService = new AuditService(prisma as unknown as PrismaService);
    validators = new FinanzasValidators(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    const [row] = await prisma.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;

    if (!row?.current_database) {
      throw new Error('Could not determine current_database()');
    }

    if (row.current_database === 'buildingos') {
      throw new Error('Refusing to run destructive integration tests against buildingos');
    }

    if (expectedDatabaseName && row.current_database !== expectedDatabaseName) {
      throw new Error(
        `Refusing to run against unexpected database ${row.current_database}; expected ${expectedDatabaseName}`,
      );
    }
  });

  const suffix = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const toResponseDto: LiquidationWorkflowDependencies['toPublishedLiquidationDto'] = (liquidation) => ({
    id: liquidation.id,
    tenantId: liquidation.tenantId,
    buildingId: liquidation.buildingId,
    period: liquidation.period,
    chargePeriod: liquidation.chargePeriod,
    status: liquidation.status,
    baseCurrency: liquidation.baseCurrency,
    totalAmountMinor: liquidation.totalAmountMinor,
    totalsByCurrency: liquidation.totalsByCurrency as Record<string, number>,
    unitCount: liquidation.unitCount,
    generatedAt: liquidation.generatedAt,
    reviewedAt: liquidation.reviewedAt,
    publishedAt: liquidation.publishedAt,
    canceledAt: liquidation.canceledAt,
    createdAt: liquidation.createdAt,
  });

  const createDeps = (options?: {
    prismaOverride?: LiquidationWorkflowDependencies['prisma'];
    sendChargePublishedNotifications?: LiquidationWorkflowDependencies['sendChargePublishedNotifications'];
  }): LiquidationWorkflowDependencies => ({
    prisma: options?.prismaOverride ?? (prisma as unknown as LiquidationWorkflowDependencies['prisma']),
    isAdminOrOperator: (roles) => validators.isAdminOrOperator(roles),
    createAuditLogRequired: (input, tx) => auditService.createLogRequired(input, tx),
    createAuditLog: (input) => auditService.createLog(input),
    toPublishedLiquidationDto: toResponseDto,
    sendChargePublishedNotifications:
      options?.sendChargePublishedNotifications ??
      (async () => ({ sentCount: 0, failedCount: 0, errorMessages: [] })),
  });

  const createUseCase = (options?: Parameters<typeof createDeps>[0]) =>
    new LiquidationPublicationUseCase(createDeps(options));

  const buildExpenseSnapshot = (
    period: string,
    totalAmountMinor: number,
  ): Prisma.InputJsonArray => [
    {
      expenseId: `exp-${period}`,
      categoryName: 'Integration Expense',
      vendorName: null,
      amountMinor: totalAmountMinor,
      currencyCode: 'ARS',
      invoiceDate: `${period}-01T00:00:00.000Z`,
      description: 'Integration expense snapshot',
      type: 'EXPENSE',
    },
  ];

  async function createFinanceContext(label: string, unitCount: number = 2) {
    const idSuffix = suffix();
    const tenant = await prisma.tenant.create({
      data: {
        name: `ITEST ${label} ${idSuffix}`,
        type: TenantType.ADMINISTRADORA,
      },
    });

    const user = await prisma.user.create({
      data: {
        email: `itest-${label}-${idSuffix}@buildingos.local`,
        name: `ITest ${label}`,
        passwordHash: 'integration-test-hash',
      },
    });

    const membership = await prisma.membership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
      },
    });

    await prisma.membershipRole.create({
      data: {
        tenantId: tenant.id,
        membershipId: membership.id,
        role: Role.TENANT_ADMIN,
        scopeType: ScopeType.TENANT,
      },
    });

    const building = await prisma.building.create({
      data: {
        tenantId: tenant.id,
        name: `ITEST Building ${label} ${idSuffix}`,
        alias: `IT-${idSuffix.slice(0, 8)}`,
        address: 'Integration Street 123',
      },
    });

    const units = await Promise.all(
      Array.from({ length: unitCount }, async (_, index) =>
        prisma.unit.create({
          data: {
            tenantId: tenant.id,
            buildingId: building.id,
            code: `U-${index + 1}`,
            label: `Unit ${index + 1}`,
            unitType: 'APARTAMENTO',
            occupancyStatus: 'OCCUPIED',
            isBillable: true,
          },
        }),
      ),
    );

    return { tenant, user, membership, building, units };
  }

  async function createDraftAndReview(params: {
    tenantId: string;
    buildingId: string;
    membershipId: string;
    period: string;
    chargePeriod?: string | null;
    totalAmountMinor?: number;
    expenseSnapshot?: Prisma.InputJsonArray;
  }) {
    const totalAmountMinor = params.totalAmountMinor ?? 200;
    const expenseSnapshot = params.expenseSnapshot ?? buildExpenseSnapshot(params.period, totalAmountMinor);

    const draft = await prisma.$transaction((tx) =>
      createLiquidationDraftRecord(
        tx,
        {
          createAuditLogRequired: (input, client) =>
            auditService.createLogRequired(input, client),
        },
        {
          tenantId: params.tenantId,
          buildingId: params.buildingId,
          period: params.period,
          chargePeriod: params.chargePeriod ?? null,
          baseCurrency: 'ARS',
          totalAmountMinor,
          totalsByCurrency: { ARS: totalAmountMinor },
          expenseSnapshot,
          unitCount: 2,
          generatedByMembershipId: params.membershipId,
        },
      ),
    );

    const reviewed = await prisma.$transaction((tx) =>
      reviewLiquidationRecord(
        tx,
        {
          createAuditLogRequired: (input, client) =>
            auditService.createLogRequired(input, client),
        },
        {
          tenantId: params.tenantId,
          liquidationId: draft.id,
          membershipId: params.membershipId,
        },
      ),
    );

    return reviewed;
  }

  async function createCancelService() {
    const notificationsService = {
      createNotification: jest.fn(),
    } as unknown as NotificationsService;

    return new LiquidationsService(
      prisma as unknown as PrismaService,
      auditService,
      validators,
      notificationsService,
      new LiquidationPublicationUseCase(
        createLiquidationWorkflowDependencies({
          prisma: prisma as unknown as PrismaService,
          auditService,
          validators,
          notificationsService,
        }),
      ),
    );
  }

  it('enforces the partial unique index and allows a new active liquidation after canceling the previous one', async () => {
    const ctx = await createFinanceContext('partial-index');

    const first = await prisma.$transaction((tx) =>
      createLiquidationDraftRecord(
        tx,
        {
          createAuditLogRequired: (input, client) =>
            auditService.createLogRequired(input, client),
        },
        {
          tenantId: ctx.tenant.id,
          buildingId: ctx.building.id,
          period: '2026-07',
          chargePeriod: '2026-08',
          baseCurrency: 'ARS',
          totalAmountMinor: 200,
          totalsByCurrency: { ARS: 200 },
          expenseSnapshot: [],
          unitCount: ctx.units.length,
          generatedByMembershipId: ctx.membership.id,
        },
      ),
    );

    await expect(
      prisma.$transaction((tx) =>
        createLiquidationDraftRecord(
          tx,
          {
            createAuditLogRequired: (input, client) =>
              auditService.createLogRequired(input, client),
          },
          {
            tenantId: ctx.tenant.id,
            buildingId: ctx.building.id,
            period: '2026-07',
            chargePeriod: '2026-08',
            baseCurrency: 'ARS',
            totalAmountMinor: 200,
            totalsByCurrency: { ARS: 200 },
            expenseSnapshot: [],
            unitCount: ctx.units.length,
            generatedByMembershipId: ctx.membership.id,
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });

    const cancelService = await createCancelService();
    const canceled = await cancelService.cancelLiquidation(
      ctx.tenant.id,
      first.id,
      ctx.membership.id,
      { reason: 'Partial index integration test' },
    );

    expect(canceled.status).toBe('CANCELED');

    const second = await prisma.$transaction((tx) =>
      createLiquidationDraftRecord(
        tx,
        {
          createAuditLogRequired: (input, client) =>
            auditService.createLogRequired(input, client),
        },
        {
          tenantId: ctx.tenant.id,
          buildingId: ctx.building.id,
          period: '2026-07',
          chargePeriod: '2026-08',
          baseCurrency: 'ARS',
          totalAmountMinor: 200,
          totalsByCurrency: { ARS: 200 },
          expenseSnapshot: [],
          unitCount: ctx.units.length,
          generatedByMembershipId: ctx.membership.id,
        },
      ),
    );

    expect(second.id).not.toBe(first.id);
  });

  it('publishes through the real PostgreSQL transaction, writes snapshot V1, audit, and charges', async () => {
    const ctx = await createFinanceContext('publish');
    const reviewed = await createDraftAndReview({
      tenantId: ctx.tenant.id,
      buildingId: ctx.building.id,
      membershipId: ctx.membership.id,
      period: '2026-09',
      chargePeriod: '2026-10',
    });

    const result = await createUseCase().execute(
      ctx.tenant.id,
      reviewed.id,
      ctx.membership.id,
      { dueDate: '2026-10-10' },
      'disabled',
    );

    expect(result.status).toBe('PUBLISHED');

    const persisted = await prisma.liquidation.findUniqueOrThrow({
      where: { id: reviewed.id },
    });
    expect(persisted.status).toBe('PUBLISHED');
    expect(persisted.publicationSnapshot).toEqual(
      expect.objectContaining({
        version: 1,
        liquidationId: reviewed.id,
        dueDate: '2026-10-10T00:00:00.000Z',
      }),
    );

    const charges = await prisma.charge.findMany({
      where: { liquidationId: reviewed.id },
      orderBy: { unitId: 'asc' },
    });
    expect(charges).toHaveLength(ctx.units.length);
    expect(charges.every((charge) => charge.liquidationId === reviewed.id)).toBe(true);

    const publishAuditCount = await prisma.auditLog.count({
      where: {
        tenantId: ctx.tenant.id,
        entity: 'Liquidation',
        entityId: reviewed.id,
        action: 'LIQUIDATION_PUBLISH',
      },
    });
    expect(publishAuditCount).toBe(1);
  });

  it('keeps the workflow idempotent across repeated executions', async () => {
    const ctx = await createFinanceContext('idempotency');

    const first = await ensureSeedPublishedLiquidation({
      prisma,
      tenantId: ctx.tenant.id,
      buildingId: ctx.building.id,
      membershipId: ctx.membership.id,
      period: '2026-11',
      chargePeriod: '2026-12',
      baseCurrency: 'ARS',
      totalAmountMinor: 200,
      totalsByCurrency: { ARS: 200 },
      expenseSnapshot: buildExpenseSnapshot('2026-11', 200),
      units: ctx.units.map((unit) => ({
        id: unit.id,
        code: unit.code,
        label: unit.label,
      })),
      dueDate: new Date('2026-12-10T00:00:00.000Z'),
      notificationPolicy: 'disabled',
    });

    const countsAfterFirst = {
      liquidations: await prisma.liquidation.count({ where: { tenantId: ctx.tenant.id } }),
      charges: await prisma.charge.count({ where: { tenantId: ctx.tenant.id } }),
      audits: await prisma.auditLog.count({
        where: { tenantId: ctx.tenant.id, entityId: first.id, entity: 'Liquidation' },
      }),
    };

    const second = await ensureSeedPublishedLiquidation({
      prisma,
      tenantId: ctx.tenant.id,
      buildingId: ctx.building.id,
      membershipId: ctx.membership.id,
      period: '2026-11',
      chargePeriod: '2026-12',
      baseCurrency: 'ARS',
      totalAmountMinor: 200,
      totalsByCurrency: { ARS: 200 },
      expenseSnapshot: buildExpenseSnapshot('2026-11', 200),
      units: ctx.units.map((unit) => ({
        id: unit.id,
        code: unit.code,
        label: unit.label,
      })),
      dueDate: new Date('2026-12-10T00:00:00.000Z'),
      notificationPolicy: 'disabled',
    });

    const countsAfterSecond = {
      liquidations: await prisma.liquidation.count({ where: { tenantId: ctx.tenant.id } }),
      charges: await prisma.charge.count({ where: { tenantId: ctx.tenant.id } }),
      audits: await prisma.auditLog.count({
        where: { tenantId: ctx.tenant.id, entityId: first.id, entity: 'Liquidation' },
      }),
    };

    expect(second.id).toBe(first.id);
    expect(countsAfterSecond).toEqual(countsAfterFirst);
  });

  it('handles concurrent publication safely without duplicating liquidations, charges, or publish audits', async () => {
    const ctx = await createFinanceContext('concurrency');
    const reviewed = await createDraftAndReview({
      tenantId: ctx.tenant.id,
      buildingId: ctx.building.id,
      membershipId: ctx.membership.id,
      period: '2027-01',
      chargePeriod: '2027-02',
    });

    const useCase = createUseCase();
    const results = await Promise.allSettled([
      useCase.execute(ctx.tenant.id, reviewed.id, ctx.membership.id, { dueDate: '2027-02-10' }, 'disabled'),
      useCase.execute(ctx.tenant.id, reviewed.id, ctx.membership.id, { dueDate: '2027-02-10' }, 'disabled'),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        throw result.reason;
      }

      expect(result.value.status).toBe('PUBLISHED');
    }

    const liquidations = await prisma.liquidation.findMany({
      where: {
        tenantId: ctx.tenant.id,
        buildingId: ctx.building.id,
        period: '2027-01',
        status: 'PUBLISHED',
      },
    });
    expect(liquidations).toHaveLength(1);

    const charges = await prisma.charge.findMany({
      where: { tenantId: ctx.tenant.id, liquidationId: reviewed.id },
    });
    expect(charges).toHaveLength(ctx.units.length);

    const publishAuditCount = await prisma.auditLog.count({
      where: {
        tenantId: ctx.tenant.id,
        entity: 'Liquidation',
        entityId: reviewed.id,
        action: 'LIQUIDATION_PUBLISH',
      },
    });
    expect(publishAuditCount).toBe(1);
  });

  it('rolls back the publication transaction when charge creation fails', async () => {
    const ctx = await createFinanceContext('rollback');
    const reviewed = await createDraftAndReview({
      tenantId: ctx.tenant.id,
      buildingId: ctx.building.id,
      membershipId: ctx.membership.id,
      period: '2027-03',
      chargePeriod: '2027-04',
    });

    const failingPrisma = {
      ...(prisma as unknown as LiquidationWorkflowDependencies['prisma']),
      $transaction: async <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
        options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
      ) =>
        prisma.$transaction(async (tx) => {
          const proxiedTx = new Proxy(tx, {
            get(target, prop, receiver) {
              if (prop === 'charge') {
                return {
                  ...target.charge,
                  createMany: async () => {
                    throw new Error('forced charge failure');
                  },
                };
              }

              return Reflect.get(target, prop, receiver);
            },
          });

          return callback(proxiedTx as Prisma.TransactionClient);
        }, options),
    };

    const useCase = createUseCase({ prismaOverride: failingPrisma });

    await expect(
      useCase.execute(
        ctx.tenant.id,
        reviewed.id,
        ctx.membership.id,
        { dueDate: '2027-04-10' },
        'disabled',
      ),
    ).rejects.toThrow('forced charge failure');

    const persisted = await prisma.liquidation.findUniqueOrThrow({
      where: { id: reviewed.id },
    });
    expect(persisted.status).toBe('REVIEWED');
    expect(await prisma.charge.count({ where: { liquidationId: reviewed.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: ctx.tenant.id,
          entityId: reviewed.id,
          entity: 'Liquidation',
          action: 'LIQUIDATION_PUBLISH',
        },
      }),
    ).toBe(0);
  });

  it('keeps notifications disabled when requested and sends post-commit notifications only after commit', async () => {
    const disabledCtx = await createFinanceContext('notifications-disabled');
    const disabledReviewed = await createDraftAndReview({
      tenantId: disabledCtx.tenant.id,
      buildingId: disabledCtx.building.id,
      membershipId: disabledCtx.membership.id,
      period: '2027-05',
      chargePeriod: '2027-06',
    });

    const disabledNotifications = jest.fn().mockResolvedValue({
      sentCount: 0,
      failedCount: 0,
      errorMessages: [],
    });

    await createUseCase({
      sendChargePublishedNotifications: disabledNotifications,
    }).execute(
      disabledCtx.tenant.id,
      disabledReviewed.id,
      disabledCtx.membership.id,
      { dueDate: '2027-06-10' },
      'disabled',
    );

    expect(disabledNotifications).not.toHaveBeenCalled();

    const postCommitCtx = await createFinanceContext('notifications-post-commit');
    const postCommitReviewed = await createDraftAndReview({
      tenantId: postCommitCtx.tenant.id,
      buildingId: postCommitCtx.building.id,
      membershipId: postCommitCtx.membership.id,
      period: '2027-07',
      chargePeriod: '2027-08',
    });

    const postCommitNotifications = jest.fn().mockImplementation(async () => {
      const liquidation = await prisma.liquidation.findUniqueOrThrow({
        where: { id: postCommitReviewed.id },
      });
      const chargeCount = await prisma.charge.count({
        where: { liquidationId: postCommitReviewed.id },
      });

      expect(liquidation.status).toBe('PUBLISHED');
      expect(chargeCount).toBe(postCommitCtx.units.length);

      return {
        sentCount: 0,
        failedCount: 1,
        errorMessages: ['simulated notification failure'],
      };
    });

    const postCommitResult = await createUseCase({
      sendChargePublishedNotifications: postCommitNotifications,
    }).execute(
      postCommitCtx.tenant.id,
      postCommitReviewed.id,
      postCommitCtx.membership.id,
      { dueDate: '2027-08-10' },
      'post-commit',
    );

    expect(postCommitResult.status).toBe('PUBLISHED');
    expect(postCommitNotifications).toHaveBeenCalledTimes(1);

    const publishAuditCount = await prisma.auditLog.count({
      where: {
        tenantId: postCommitCtx.tenant.id,
        entity: 'Liquidation',
        entityId: postCommitReviewed.id,
        action: 'LIQUIDATION_PUBLISH',
      },
    });
    expect(publishAuditCount).toBe(2);
  });

  it('recovers safely after a partial seed failure without duplicating tenant, building, units, liquidation, charges, or audit logs', async () => {
    const seedKey = suffix();
    const period = '2027-09';
    const chargePeriod = '2027-10';
    const dueDate = new Date('2027-10-10T00:00:00.000Z');

    const runResumableSeedPass = async (failAfterWorkflow: boolean) => {
      const tenant = await prisma.tenant.upsert({
        where: { name: `ITEST Seed Tenant ${seedKey}` },
        update: {},
        create: {
          name: `ITEST Seed Tenant ${seedKey}`,
          type: TenantType.ADMINISTRADORA,
        },
      });

      const user = await prisma.user.upsert({
        where: { email: `itest-seed-${seedKey}@buildingos.local` },
        update: {},
        create: {
          email: `itest-seed-${seedKey}@buildingos.local`,
          name: 'ITest Seed User',
          passwordHash: 'integration-test-hash',
        },
      });

      const membership = await prisma.membership.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
        update: {},
        create: {
          tenantId: tenant.id,
          userId: user.id,
        },
      });

      await prisma.membershipRole.upsert({
        where: {
          id: `${membership.id}-tenant-admin`,
        },
        update: {},
        create: {
          id: `${membership.id}-tenant-admin`,
          tenantId: tenant.id,
          membershipId: membership.id,
          role: Role.TENANT_ADMIN,
          scopeType: ScopeType.TENANT,
        },
      });

      const building = await prisma.building.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: `ITEST Seed Building ${seedKey}` } },
        update: {},
        create: {
          tenantId: tenant.id,
          name: `ITEST Seed Building ${seedKey}`,
          alias: `IS-${seedKey.slice(0, 8)}`,
          address: 'Resume Avenue 123',
        },
      });

      const units = await Promise.all(
        ['A', 'B'].map((code) =>
          prisma.unit.upsert({
            where: {
              buildingId_code: {
                buildingId: building.id,
                code: `U-${code}`,
              },
            },
            update: {},
            create: {
              tenantId: tenant.id,
              buildingId: building.id,
              code: `U-${code}`,
              label: `Unit ${code}`,
              unitType: 'APARTAMENTO',
              occupancyStatus: 'OCCUPIED',
              isBillable: true,
            },
          }),
        ),
      );

      await ensureSeedPublishedLiquidation({
        prisma,
        tenantId: tenant.id,
        buildingId: building.id,
        membershipId: membership.id,
        period,
        chargePeriod,
        baseCurrency: 'ARS',
        totalAmountMinor: 200,
        totalsByCurrency: { ARS: 200 },
        expenseSnapshot: buildExpenseSnapshot(period, 200),
        units: units.map((unit) => ({
          id: unit.id,
          code: unit.code,
          label: unit.label,
        })),
        dueDate,
        notificationPolicy: 'disabled',
      });

      if (failAfterWorkflow) {
        throw new Error('intentional post-workflow failure');
      }

      return { tenant, building, units };
    };

    await expect(runResumableSeedPass(true)).rejects.toThrow(
      'intentional post-workflow failure',
    );

    const tenantAfterFirst = await prisma.tenant.findFirstOrThrow({
      where: { name: `ITEST Seed Tenant ${seedKey}` },
    });
    const buildingAfterFirst = await prisma.building.findFirstOrThrow({
      where: { tenantId: tenantAfterFirst.id, name: `ITEST Seed Building ${seedKey}` },
    });

    const countsAfterFirst = {
      tenants: await prisma.tenant.count({
        where: { name: `ITEST Seed Tenant ${seedKey}` },
      }),
      buildings: await prisma.building.count({
        where: { tenantId: tenantAfterFirst.id, name: `ITEST Seed Building ${seedKey}` },
      }),
      units: await prisma.unit.count({
        where: { tenantId: tenantAfterFirst.id, buildingId: buildingAfterFirst.id },
      }),
      liquidations: await prisma.liquidation.count({
        where: { tenantId: tenantAfterFirst.id, buildingId: buildingAfterFirst.id, period },
      }),
      charges: await prisma.charge.count({
        where: { tenantId: tenantAfterFirst.id, buildingId: buildingAfterFirst.id },
      }),
      audits: await prisma.auditLog.count({
        where: { tenantId: tenantAfterFirst.id, entity: 'Liquidation' },
      }),
    };

    await runResumableSeedPass(false);

    const countsAfterSecond = {
      tenants: await prisma.tenant.count({
        where: { name: `ITEST Seed Tenant ${seedKey}` },
      }),
      buildings: await prisma.building.count({
        where: { tenantId: tenantAfterFirst.id, name: `ITEST Seed Building ${seedKey}` },
      }),
      units: await prisma.unit.count({
        where: { tenantId: tenantAfterFirst.id, buildingId: buildingAfterFirst.id },
      }),
      liquidations: await prisma.liquidation.count({
        where: { tenantId: tenantAfterFirst.id, buildingId: buildingAfterFirst.id, period },
      }),
      charges: await prisma.charge.count({
        where: { tenantId: tenantAfterFirst.id, buildingId: buildingAfterFirst.id },
      }),
      audits: await prisma.auditLog.count({
        where: { tenantId: tenantAfterFirst.id, entity: 'Liquidation' },
      }),
    };

    expect(countsAfterSecond).toEqual(countsAfterFirst);
  });
});
