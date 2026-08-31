import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  TenantType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ResidentAccessService } from '../resident-access/resident-access.service';
import { FinanzasValidators } from './finanzas.validators';
import { CurrencyConversionService } from './currency-conversion.service';
import { MovementAllocationService } from './movement-allocation.service';
import { ExpensesService } from './expenses.service';
import { IncomesService } from './incomes.service';
import { CreateExpenseDto, CreateIncomeDto } from './expense-ledger.dto';

const ACCEPTANCE_DATABASES = new Set(['buildingos_fin02a_acceptance']);
const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  expectedDatabaseName !== undefined &&
  ACCEPTANCE_DATABASES.has(expectedDatabaseName);
const describePostgres = enabled ? describe : describe.skip;
const TEST_BARRIER_KEY = 'buildingos:finance:fin02a:test-barrier:v1';

describePostgres('Atomic movement lifecycle PostgreSQL', () => {
  let observer: PrismaClient;
  let clientA: PrismaClient;
  let clientB: PrismaClient;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const membershipIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    observer = new PrismaClient();
    clientA = new PrismaClient();
    clientB = new PrismaClient();
    await Promise.all([observer.$connect(), clientA.$connect(), clientB.$connect()]);
    const [database] = await observer.$queryRaw<Array<{ name: string }>>`
      SELECT current_database() AS name
    `;
    if (database?.name !== expectedDatabaseName || !ACCEPTANCE_DATABASES.has(database.name)) {
      throw new Error(`Refusing non-disposable test database ${database?.name ?? 'unknown'}`);
    }
  });

  afterEach(async () => {
    for (const membershipId of membershipIds.splice(0)) {
      await observer.membership.delete({ where: { id: membershipId } }).catch(() => undefined);
    }
    for (const tenantId of tenantIds.splice(0)) {
      await observer.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    }
    for (const userId of userIds.splice(0)) {
      await observer.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  });

  afterAll(async () => {
    await Promise.all([
      observer?.$disconnect(),
      clientA?.$disconnect(),
      clientB?.$disconnect(),
    ]);
  });

  async function fixture(label: string) {
    const suffix = `${Date.now()}-${Math.random()}`;
    const tenant = await observer.tenant.create({
      data: { name: `fin02a-${label}-${suffix}`, type: TenantType.ADMINISTRADORA },
    });
    tenantIds.push(tenant.id);
    const user = await observer.user.create({
      data: {
        email: `fin02a-${suffix}@buildingos.local`,
        name: 'FIN-02A test user',
        passwordHash: 'test',
      },
    });
    userIds.push(user.id);
    const membership = await observer.membership.create({
      data: { tenantId: tenant.id, userId: user.id },
    });
    membershipIds.push(membership.id);
    const building = await observer.building.create({
      data: {
        tenantId: tenant.id,
        name: `Building ${suffix}`,
        alias: `F-${suffix}`,
        address: 'Test address',
      },
    });
    const secondBuilding = await observer.building.create({
      data: {
        tenantId: tenant.id,
        name: `Building 2 ${suffix}`,
        alias: `G-${suffix}`,
        address: 'Test address 2',
      },
    });
    const expenseCategory = await observer.expenseLedgerCategory.create({
      data: {
        tenantId: tenant.id,
        name: `Expense ${suffix}`,
        movementType: 'EXPENSE',
        catalogScope: 'BUILDING',
      },
    });
    const sharedExpenseCategory = await observer.expenseLedgerCategory.create({
      data: {
        tenantId: tenant.id,
        name: `Shared expense ${suffix}`,
        movementType: 'EXPENSE',
        catalogScope: 'CONDOMINIUM_COMMON',
      },
    });
    const incomeCategory = await observer.expenseLedgerCategory.create({
      data: {
        tenantId: tenant.id,
        name: `Income ${suffix}`,
        movementType: 'INCOME',
        catalogScope: 'CONDOMINIUM_COMMON',
      },
    });
    const vendor = await observer.vendor.create({
      data: {
        tenantId: tenant.id,
        name: `Vendor ${suffix}`,
      },
    });
    const unitGroup = await observer.unitGroup.create({
      data: {
        tenantId: tenant.id,
        buildingId: building.id,
        name: `Group ${suffix}`,
      },
    });
    return { tenant, membership, building, secondBuilding, expenseCategory, sharedExpenseCategory, incomeCategory, unitGroup, vendor };
  }

  function services(client: PrismaClient, movement?: MovementAllocationService) {
    const prisma = client as unknown as PrismaService;
    const audit = { createLog: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const validators = new FinanzasValidators(
      prisma,
      new ResidentAccessService(prisma),
    );
    const allocations = movement ?? new MovementAllocationService(prisma, audit, validators);
    return {
      expenses: new ExpensesService(
        prisma,
        audit,
        validators,
        allocations,
        new CurrencyConversionService(prisma),
      ),
      incomes: new IncomesService(
        prisma,
        audit,
        validators,
        allocations,
        new CurrencyConversionService(prisma),
      ),
    };
  }

  async function installRaceBarrier(): Promise<void> {
    await observer.$executeRaw(Prisma.sql`
      CREATE OR REPLACE FUNCTION "fin02a_block_update"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        PERFORM pg_advisory_xact_lock(
          hashtextextended('buildingos:finance:fin02a:test-barrier:v1', 0)
        );
        RETURN NEW;
      END;
      $function$
    `);
    await observer.$executeRaw(Prisma.sql`
      DROP TRIGGER IF EXISTS "fin02a_block_update" ON "Expense"
    `);
    await observer.$executeRaw(Prisma.sql`
      DROP TRIGGER IF EXISTS "fin02a_block_update" ON "Income"
    `);
    await observer.$executeRaw(Prisma.sql`
      CREATE TRIGGER "fin02a_block_update"
      BEFORE UPDATE ON "Expense"
      FOR EACH ROW EXECUTE FUNCTION "fin02a_block_update"()
    `);
    await observer.$executeRaw(Prisma.sql`
      CREATE TRIGGER "fin02a_block_update"
      BEFORE UPDATE ON "Income"
      FOR EACH ROW EXECUTE FUNCTION "fin02a_block_update"()
    `);
  }

  async function removeRaceBarrier(): Promise<void> {
    await observer.$executeRaw(Prisma.sql`
      DROP TRIGGER IF EXISTS "fin02a_block_update" ON "Expense"
    `);
    await observer.$executeRaw(Prisma.sql`
      DROP TRIGGER IF EXISTS "fin02a_block_update" ON "Income"
    `);
    await observer.$executeRaw(Prisma.sql`
      DROP FUNCTION IF EXISTS "fin02a_block_update"()
    `);
  }

  async function holdRaceBarrier(): Promise<{
    release: () => void;
    transaction: Promise<void>;
  }> {
    let resolveReady!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = observer.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${TEST_BARRIER_KEY}, 0))`,
        );
        resolveReady();
        await released;
      },
      { maxWait: 5000, timeout: 30000 },
    );
    await ready;
    return { release, transaction };
  }

  async function waitForAdvisoryWaiters(expected: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await observer.$queryRaw<Array<{ waiters: number }>>`
        SELECT count(*)::int AS waiters
        FROM pg_locks
        WHERE locktype = 'advisory' AND granted = false
      `;
      if ((rows[0]?.waiters ?? 0) >= expected) {
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Expected ${expected} advisory lock waiters`);
  }

  async function runControlledRace(
    firstOperation: () => Promise<unknown>,
    secondOperation: () => Promise<unknown>,
  ): Promise<PromiseSettledResult<unknown>[]> {
    await installRaceBarrier();
    const barrier = await holdRaceBarrier();
    try {
      const first = firstOperation();
      await waitForAdvisoryWaiters(1);

      const second = secondOperation();
      await waitForAdvisoryWaiters(2);

      barrier.release();
      return await Promise.allSettled([first, second]);
    } finally {
      barrier.release();
      await barrier.transaction;
      await removeRaceBarrier();
    }
  }

  function expenseDto(ctx: Awaited<ReturnType<typeof fixture>>, scopeType: CreateExpenseDto['scopeType']): CreateExpenseDto {
    return {
      period: '2026-08',
      categoryId: scopeType === 'TENANT_SHARED'
        ? ctx.sharedExpenseCategory.id
        : ctx.expenseCategory.id,
      amountMinor: 1000,
      currencyCode: 'ARS',
      invoiceDate: '2026-08-01',
      scopeType,
      buildingId: scopeType === 'BUILDING' ? ctx.building.id : undefined,
      vendorId: scopeType === 'BUILDING' ? ctx.vendor.id : undefined,
      unitGroupId: scopeType === 'UNIT_GROUP' ? ctx.unitGroup.id : undefined,
      allocations: scopeType === 'BUILDING'
        ? undefined
        : [{ buildingId: ctx.building.id, percentage: 100 }],
    };
  }

  function incomeDto(ctx: Awaited<ReturnType<typeof fixture>>, scopeType: CreateIncomeDto['scopeType']): CreateIncomeDto {
    return {
      period: '2026-08',
      categoryId: ctx.incomeCategory.id,
      amountMinor: 1000,
      currencyCode: 'ARS',
      receivedDate: '2026-08-01',
      scopeType,
      buildingId: scopeType === 'BUILDING' ? ctx.building.id : undefined,
      unitGroupId: scopeType === 'UNIT_GROUP' ? ctx.unitGroup.id : undefined,
      allocations: scopeType === 'BUILDING'
        ? undefined
        : [{ buildingId: ctx.building.id, percentage: 100 }],
    };
  }

  it('creates BUILDING, TENANT_SHARED and UNIT_GROUP Expenses with exact allocation totals', async () => {
    const ctx = await fixture('expense-create');
    const { expenses } = services(clientA);

    await expenses.createExpense(ctx.tenant.id, ctx.membership.id, ['TENANT_ADMIN'], expenseDto(ctx, 'BUILDING'));
    await expenses.createExpense(ctx.tenant.id, ctx.membership.id, ['TENANT_ADMIN'], expenseDto(ctx, 'TENANT_SHARED'));
    await expenses.createExpense(ctx.tenant.id, ctx.membership.id, ['TENANT_ADMIN'], expenseDto(ctx, 'UNIT_GROUP'));

    expect(await observer.expense.count({ where: { tenantId: ctx.tenant.id } })).toBe(3);
    expect(await observer.movementAllocation.count({ where: { tenantId: ctx.tenant.id } })).toBe(2);
    const total = await observer.movementAllocation.aggregate({
      where: { tenantId: ctx.tenant.id },
      _sum: { amountMinor: true },
    });
    expect(total._sum.amountMinor).toBe(2000);
  });

  it('rolls back an Expense parent when allocation persistence fails', async () => {
    const ctx = await fixture('expense-rollback');
    const movement = {
      validateAllocations: jest.fn().mockResolvedValue(undefined),
      createForExpenseInTx: jest.fn().mockRejectedValue(new Error('forced allocation failure')),
    } as unknown as MovementAllocationService;
    const { expenses } = services(clientA, movement);

    await expect(expenses.createExpense(
      ctx.tenant.id,
      ctx.membership.id,
      ['TENANT_ADMIN'],
      expenseDto(ctx, 'TENANT_SHARED'),
    )).rejects.toThrow('forced allocation failure');

    expect(await observer.expense.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    expect(await observer.movementAllocation.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
  });

  it('rejects an incomplete Expense allocation list without persisting anything', async () => {
    const ctx = await fixture('expense-invalid-allocation');
    const { expenses } = services(clientA);
    const dto = expenseDto(ctx, 'TENANT_SHARED');
    dto.allocations = [
      { buildingId: ctx.building.id, percentage: 100 },
      { buildingId: ctx.secondBuilding.id },
    ];

    await expect(
      expenses.createExpense(ctx.tenant.id, ctx.membership.id, ['TENANT_ADMIN'], dto),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await observer.expense.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    expect(await observer.movementAllocation.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
  });

  it('rejects amount changes for allocated Expenses and allows a valid unallocated update', async () => {
    const ctx = await fixture('expense-update');
    const { expenses } = services(clientA);
    const allocated = await expenses.createExpense(
      ctx.tenant.id,
      ctx.membership.id,
      ['TENANT_ADMIN'],
      expenseDto(ctx, 'TENANT_SHARED'),
    );

    await expect(expenses.updateExpense(
      ctx.tenant.id,
      allocated.id,
      ctx.membership.id,
      ['TENANT_ADMIN'],
      { amountMinor: 2000 },
    )).rejects.toBeInstanceOf(ConflictException);

    const building = await expenses.createExpense(
      ctx.tenant.id,
      ctx.membership.id,
      ['TENANT_ADMIN'],
      expenseDto(ctx, 'BUILDING'),
    );
    await expenses.updateExpense(
      ctx.tenant.id,
      building.id,
      ctx.membership.id,
      ['TENANT_ADMIN'],
      { amountMinor: 2000 },
    );
    expect(await observer.expense.findUniqueOrThrow({ where: { id: building.id } })).toMatchObject({ amountMinor: 2000 });
  });

  it('creates BUILDING, TENANT_SHARED and UNIT_GROUP Incomes atomically', async () => {
    const ctx = await fixture('income-create');
    const { incomes } = services(clientA);

    await incomes.createIncome(ctx.tenant.id, ctx.membership.id, ['TENANT_ADMIN'], incomeDto(ctx, 'BUILDING'));
    await incomes.createIncome(ctx.tenant.id, ctx.membership.id, ['TENANT_ADMIN'], incomeDto(ctx, 'TENANT_SHARED'));
    await incomes.createIncome(ctx.tenant.id, ctx.membership.id, ['TENANT_ADMIN'], incomeDto(ctx, 'UNIT_GROUP'));

    expect(await observer.income.count({ where: { tenantId: ctx.tenant.id } })).toBe(3);
    expect(await observer.movementAllocation.count({ where: { tenantId: ctx.tenant.id } })).toBe(2);
  });

  it('rolls back an Income parent when allocation persistence fails', async () => {
    const ctx = await fixture('income-rollback');
    const movement = {
      validateAllocations: jest.fn().mockResolvedValue(undefined),
      createForIncomeInTx: jest.fn().mockRejectedValue(new Error('forced allocation failure')),
    } as unknown as MovementAllocationService;
    const { incomes } = services(clientA, movement);

    await expect(incomes.createIncome(
      ctx.tenant.id,
      ctx.membership.id,
      ['TENANT_ADMIN'],
      incomeDto(ctx, 'TENANT_SHARED'),
    )).rejects.toThrow('forced allocation failure');

    expect(await observer.income.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    expect(await observer.movementAllocation.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
  });

  it('rejects an incomplete Income allocation list without persisting anything', async () => {
    const ctx = await fixture('income-invalid-allocation');
    const { incomes } = services(clientA);
    const dto = incomeDto(ctx, 'TENANT_SHARED');
    dto.allocations = [
      { buildingId: ctx.building.id, amountMinor: 1000 },
      { buildingId: ctx.secondBuilding.id },
    ];

    await expect(
      incomes.createIncome(ctx.tenant.id, ctx.membership.id, ['TENANT_ADMIN'], dto),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await observer.income.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
    expect(await observer.movementAllocation.count({ where: { tenantId: ctx.tenant.id } })).toBe(0);
  });

  it('rejects currency changes for allocated Incomes and serializes concurrent DRAFT updates', async () => {
    const ctx = await fixture('income-update');
    const { incomes: incomesA } = services(clientA);
    const { incomes: incomesB } = services(clientB);
    const allocated = await incomesA.createIncome(
      ctx.tenant.id,
      ctx.membership.id,
      ['TENANT_ADMIN'],
      incomeDto(ctx, 'TENANT_SHARED'),
    );

    const results = await Promise.allSettled([
      incomesA.updateIncome(ctx.tenant.id, allocated.id, ctx.membership.id, ['TENANT_ADMIN'], { currencyCode: 'USD' }),
      incomesB.updateIncome(ctx.tenant.id, allocated.id, ctx.membership.id, ['TENANT_ADMIN'], { currencyCode: 'USD' }),
    ]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(await observer.income.findUniqueOrThrow({ where: { id: allocated.id } })).toMatchObject({ currencyCode: 'ARS' });
    expect(await observer.movementAllocation.count({ where: { incomeId: allocated.id } })).toBe(1);
  });

  it('serializes an Expense update against validation using two PostgreSQL clients', async () => {
    const ctx = await fixture('expense-update-validate-race');
    const { expenses: expensesA } = services(clientA);
    const { expenses: expensesB } = services(clientB);
    const draft = await expensesA.createExpense(
      ctx.tenant.id,
      ctx.membership.id,
      ['TENANT_ADMIN'],
      expenseDto(ctx, 'BUILDING'),
    );

    const results = await runControlledRace(
      () => expensesA.updateExpense(
        ctx.tenant.id,
        draft.id,
        ctx.membership.id,
        ['TENANT_ADMIN'],
        { amountMinor: 2000, description: 'updated before validation' },
      ),
      () => expensesB.validateExpense(ctx.tenant.id, draft.id, ctx.membership.id, ['TENANT_ADMIN']),
    );

    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]?.status).toBe('fulfilled');
    const updatedExpense = await observer.expense.findUniqueOrThrow({ where: { id: draft.id } });
    expect(updatedExpense.status).toBe('VALIDATED');
    expect(updatedExpense.functionalAmountMinor).toBe(updatedExpense.amountMinor);
    expect(updatedExpense.amountMinor).toBe(2000);
  });

  it('serializes Expense validation against void without state resurrection', async () => {
    const ctx = await fixture('expense-validate-void-race');
    const { expenses: expensesA } = services(clientA);
    const { expenses: expensesB } = services(clientB);
    const draft = await expensesA.createExpense(
      ctx.tenant.id,
      ctx.membership.id,
      ['TENANT_ADMIN'],
      expenseDto(ctx, 'BUILDING'),
    );

    const results = await runControlledRace(
      () => expensesA.validateExpense(ctx.tenant.id, draft.id, ctx.membership.id, ['TENANT_ADMIN']),
      () => expensesB.voidExpense(ctx.tenant.id, draft.id, ctx.membership.id, ['TENANT_ADMIN']),
    );

    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]?.status).toBe('fulfilled');
    expect(await observer.expense.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      status: 'VOID',
    });
  });

  it('serializes an Income update against recording with a consistent snapshot', async () => {
    const ctx = await fixture('income-update-record-race');
    const { incomes: incomesA } = services(clientA);
    const { incomes: incomesB } = services(clientB);
    const draft = await incomesA.createIncome(
      ctx.tenant.id,
      ctx.membership.id,
      ['TENANT_ADMIN'],
      incomeDto(ctx, 'BUILDING'),
    );

    const results = await runControlledRace(
      () => incomesA.updateIncome(
        ctx.tenant.id,
        draft.id,
        ctx.membership.id,
        ['TENANT_ADMIN'],
        { amountMinor: 2000, description: 'updated before recording' },
      ),
      () => incomesB.recordIncome(ctx.tenant.id, draft.id, ctx.membership.id, ['TENANT_ADMIN']),
    );

    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]?.status).toBe('fulfilled');
    const recordedIncome = await observer.income.findUniqueOrThrow({ where: { id: draft.id } });
    expect(recordedIncome.status).toBe('RECORDED');
    expect(recordedIncome.functionalAmountMinor).toBe(recordedIncome.amountMinor);
    expect(recordedIncome.amountMinor).toBe(2000);
  });
});
