import { FundTransactionDirection, PrismaClient, TenantType } from '@prisma/client';
import { FundsService } from './funds.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { PrismaService } from '../prisma/prisma.service';

const ACCEPTANCE_DATABASES = new Set(['buildingos_fin02_acceptance']);
const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
const fixturePhase = 'fin02';
const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  expectedDatabaseName !== undefined &&
  ACCEPTANCE_DATABASES.has(expectedDatabaseName);
const describePostgres = enabled ? describe : describe.skip;

describePostgres('Funds ledger PostgreSQL concurrency', () => {
  let observer: PrismaClient;
  let firstClient: PrismaClient;
  let secondClient: PrismaClient;
  let service: FundsService;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const membershipIds: string[] = [];

  /**
   * Instancia FundsService real sobre un PrismaClient real de la DB de
   * aceptación (gated). El auditoría es real: escribe AuditLog en el tenant.
   */
  function buildService(client: PrismaClient): FundsService {
    const prisma = client as unknown as PrismaService;
    const audit = new AuditService(prisma);
    const validators = new FinanzasValidators(prisma);
    return new FundsService(prisma, audit, validators);
  }

  /**
   * Igual que buildService pero con un AuditService cuyo createLogRequired
   * lanza un error controlado (para probar rollback real de la transacción).
   */
  function buildServiceWithFailingAudit(client: PrismaClient): FundsService {
    const prisma = client as unknown as PrismaService;
    const audit = {
      createLogRequired: async () => {
        throw new Error('FORCED_AUDIT_FAILURE');
      },
    } as unknown as AuditService;
    const validators = new FinanzasValidators(prisma);
    return new FundsService(prisma, audit, validators);
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    observer = new PrismaClient();
    firstClient = new PrismaClient();
    secondClient = new PrismaClient();
    await Promise.all([observer.$connect(), firstClient.$connect(), secondClient.$connect()]);
    const [database] = await observer.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (database?.name !== expectedDatabaseName || !ACCEPTANCE_DATABASES.has(database.name)) {
      throw new Error(`Refusing destructive test database ${database?.name ?? 'unknown'}`);
    }
    service = buildService(firstClient);
  });

  afterEach(async () => {
    for (const membershipId of membershipIds.splice(0)) {
      await observer.membership.delete({ where: { id: membershipId } }).catch(() => undefined);
    }
    for (const tenantId of tenantIds.splice(0)) {
      await observer.tenant.delete({ where: { id: tenantId } });
    }
    for (const userId of userIds.splice(0)) {
      await observer.user.delete({ where: { id: userId } });
    }
  });

  afterAll(async () => {
    await Promise.all([
      observer?.$disconnect(),
      firstClient?.$disconnect(),
      secondClient?.$disconnect(),
    ]);
  });

  async function fixture(label: string) {
    const suffix = `${Date.now()}-${Math.random()}`;
    const tenant = await observer.tenant.create({
      data: { name: `${fixturePhase}-${label}-${suffix}`, type: TenantType.ADMINISTRADORA },
    });
    tenantIds.push(tenant.id);
    const user = await observer.user.create({
      data: {
        email: `${fixturePhase}-${suffix}@buildingos.local`,
        name: `${fixturePhase} concurrency`,
        passwordHash: 'test',
      },
    });
    userIds.push(user.id);
    const membership = await observer.membership.create({
      data: { tenantId: tenant.id, userId: user.id },
    });
    membershipIds.push(membership.id);
    const fund = await observer.fund.create({
      data: {
        tenantId: tenant.id,
        scopeType: 'TENANT',
        type: 'RESERVE',
        name: `Reserva ${suffix}`,
        createdByMembershipId: membership.id,
      },
    });
    return { tenant, membership, fund };
  }

  async function waitUntilBlocked(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [activity] = await observer.$queryRaw<Array<{ wait_event_type: string | null }>>`
        SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}
      `;
      if (activity?.wait_event_type === 'Lock') return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Backend ${pid} did not reach a database lock wait`);
  }

  /**
   * Ejecuta un DEBIT contra un fondo. Usa advisory lock + transacción.
   * Devuelve el resultado o el error.
   */
  async function tryDebit(
    client: PrismaClient,
    tenantId: string,
    fundId: string,
    membershipId: string,
    amountMinor: number,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`buildingos_fund_lock_v1:${tenantId}:${fundId}`}, 0))`;
        const fund = await tx.fund.findFirst({ where: { id: fundId, tenantId } });
        if (!fund) throw new Error('fund missing');
        const [creditAgg] = await tx.$queryRaw<Array<{ total: bigint | null }>>`
          SELECT COALESCE(SUM("amountMinor"), 0) AS total
          FROM "FundTransaction"
          WHERE "fundId" = ${fundId} AND "tenantId" = ${tenantId} AND direction = 'CREDIT'
        `;
        const [debitAgg] = await tx.$queryRaw<Array<{ total: bigint | null }>>`
          SELECT COALESCE(SUM("amountMinor"), 0) AS total
          FROM "FundTransaction"
          WHERE "fundId" = ${fundId} AND "tenantId" = ${tenantId} AND direction = 'DEBIT'
        `;
        const balance = Number(creditAgg?.total ?? 0) - Number(debitAgg?.total ?? 0);
        if (balance < amountMinor) {
          throw new Error('INSUFFICIENT_FUNDS');
        }
        await tx.fundTransaction.create({
          data: {
            tenantId,
            fundId,
            direction: FundTransactionDirection.DEBIT,
            amountMinor,
            currencyCode: 'USD',
            occurredAt: new Date(),
            createdByMembershipId: membershipId,
          },
        });
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  it('serializes two concurrent debits: only one succeeds, balance never negative', async () => {
    const ctx = await fixture('debit-race');
    await observer.fundTransaction.create({
      data: {
        tenantId: ctx.tenant.id,
        fundId: ctx.fund.id,
        direction: FundTransactionDirection.CREDIT,
        amountMinor: 10000, // USD 100.00 inicial
        currencyCode: 'USD',
        occurredAt: new Date(),
        createdByMembershipId: ctx.membership.id,
      },
    });

    // Ambos debitan 8000 en paralelo contra un saldo de 10000.
    // El advisory lock por (tenantId, fundId) serializa: solo uno completa.
    const [first, second] = await Promise.all([
      tryDebit(firstClient, ctx.tenant.id, ctx.fund.id, ctx.membership.id, 8000),
      tryDebit(secondClient, ctx.tenant.id, ctx.fund.id, ctx.membership.id, 8000),
    ]);

    const [balanceAgg] = await observer.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN "amountMinor" ELSE -"amountMinor" END), 0) AS total
      FROM "FundTransaction"
      WHERE "fundId" = ${ctx.fund.id} AND "tenantId" = ${ctx.tenant.id}
    `;
    const finalBalance = Number(balanceAgg?.total ?? 0);

    const outcomes = [first.ok, second.ok].sort();
    expect(outcomes).toEqual([false, true]);
    expect(finalBalance).toBeGreaterThanOrEqual(0);
    expect(finalBalance).toBe(2000); // 10000 - 8000 = 2000
  }, 20000);

  it('allows only one ACTIVE fund with the same normalized name under concurrent creation', async () => {
    const ctx = await fixture('name-race');

    async function tryCreateFund(client: PrismaClient, name: string): Promise<{ ok: boolean; error?: string }> {
      try {
        await client.fund.create({
          data: {
            tenantId: ctx.tenant.id,
            scopeType: 'TENANT',
            type: 'RESERVE',
            name,
            createdByMembershipId: ctx.membership.id,
          },
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    // Dos creaciones concurrentes del MISMO nombre normalizado en el mismo scope.
    const [first, second] = await Promise.all([
      tryCreateFund(firstClient, 'Fondo de reserva'),
      tryCreateFund(secondClient, '  fondo  de RESERVA '),
    ]);

    const racingNameCount = await observer.fund.count({
      where: {
        tenantId: ctx.tenant.id,
        status: 'ACTIVE',
        OR: [{ name: 'Fondo de reserva' }, { name: '  fondo  de RESERVA ' }],
      },
    });

    const outcomes = [first.ok, second.ok].sort();
    expect(outcomes).toEqual([false, true]);
    expect(racingNameCount).toBe(1);
  }, 20000);

  it('preserves fund history against DELETE (Restrict semantics)', async () => {
    const ctx = await fixture('delete-safety');
    await observer.fundTransaction.create({
      data: {
        tenantId: ctx.tenant.id,
        fundId: ctx.fund.id,
        direction: FundTransactionDirection.CREDIT,
        amountMinor: 1000,
        currencyCode: 'USD',
        occurredAt: new Date(),
        createdByMembershipId: ctx.membership.id,
      },
    });

    // B. DELETE Fund con ledger → RESTRICT: debe fallar y preservar todo.
    await expect(
      observer.fund.delete({ where: { id: ctx.fund.id } }),
    ).rejects.toThrow(/foreign key|Foreign key|constraint/);
    expect(await observer.fund.count({ where: { id: ctx.fund.id } })).toBe(1);
    expect(
      await observer.fundTransaction.count({ where: { fundId: ctx.fund.id } }),
    ).toBe(1);

    // A. DELETE Tenant borra todo el tenant (cascade estándar del repo).
    await observer.tenant.delete({ where: { id: ctx.tenant.id } });
    expect(await observer.fund.count({ where: { id: ctx.fund.id } })).toBe(0);
    expect(
      await observer.fundTransaction.count({ where: { fundId: ctx.fund.id } }),
    ).toBe(0);
    // afterEach no debe volver a borrar el tenant ya eliminado
    tenantIds.splice(tenantIds.indexOf(ctx.tenant.id), 1);
    membershipIds.splice(membershipIds.indexOf(ctx.membership.id), 1);
  }, 20000);

  it('blocks DELETE Building while a building-scoped fund exists (Restrict)', async () => {
    const ctx = await fixture('building-delete-safety');
    const building = await observer.building.create({
      data: { tenantId: ctx.tenant.id, name: `B-${Date.now()}`, alias: `B-${Date.now()}`, address: 'x' },
    });
    await observer.fund.create({
      data: {
        tenantId: ctx.tenant.id,
        buildingId: building.id,
        scopeType: 'BUILDING',
        type: 'RESERVE',
        name: `Fondo edificio ${Date.now()}`,
        createdByMembershipId: ctx.membership.id,
      },
    });

    await expect(
      observer.building.delete({ where: { id: building.id } }),
    ).rejects.toThrow(/foreign key|Foreign key|constraint/);
    expect(await observer.fund.count({ where: { buildingId: building.id } })).toBe(1);
  }, 20000);

  it('serializes archiveFund against a concurrent CREDIT (never ARCHIVED with non-zero balance)', async () => {
    const ctx = await fixture('archive-race');

    // 5 iteraciones: el resultado permitido es serializable (archive gana → credit
    // falla y balance 0; o credit gana → archive falla y balance 100). Prohibido:
    // fund ARCHIVED con balance != 0.
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const raceService = buildService(firstClient);
      const creditService = buildService(secondClient);

      const [archiveResult, creditResult] = await Promise.all([
        raceService.archiveFund(ctx.tenant.id, ctx.fund.id, ctx.membership.id, ['TENANT_ADMIN']).then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }),
        ),
        creditService.createTransaction(ctx.tenant.id, ctx.fund.id, ctx.membership.id, ['TENANT_ADMIN'], {
          direction: FundTransactionDirection.CREDIT,
          amountMinor: 100,
          currencyCode: 'USD',
          occurredAt: new Date().toISOString(),
        }).then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }),
        ),
      ]);

      const fund = await observer.fund.findUniqueOrThrow({ where: { id: ctx.fund.id } });
      const balanceRows = await observer.$queryRaw<Array<{ total: bigint | null }>>`
        SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN "amountMinor" ELSE -"amountMinor" END), 0) AS total
        FROM "FundTransaction" WHERE "fundId" = ${ctx.fund.id} AND "tenantId" = ${ctx.tenant.id}
      `;
      const balance = Number(balanceRows[0]?.total ?? 0);

      const archiveWon = archiveResult.ok;
      const creditWon = creditResult.ok;
      if (archiveWon) {
        // archive gana → credit debe fallar y balance 0
        expect(fund.status).toBe('ARCHIVED');
        expect(creditWon).toBe(false);
        expect(balance).toBe(0);
      } else {
        // credit gana → archive falla (saldo != 0) y fund ACTIVE con balance 100
        expect(fund.status).toBe('ACTIVE');
        expect(creditWon).toBe(true);
        expect(balance).toBe(100);
      }
      expect(archiveWon || creditWon).toBe(true);

      // Reset para la siguiente iteración: restaurar fund ACTIVE con balance 0
      // (el escenario original) borrando el ledger y el estado archivado.
      await observer.fundTransaction.deleteMany({ where: { fundId: ctx.fund.id } });
      await observer.fund.update({
        where: { id: ctx.fund.id },
        data: { status: 'ACTIVE', archivedAt: null, archivedByMembershipId: null },
      });
    }
  }, 30000);

  it('dedupes concurrent same-operation idempotencyKey (one persisted row, balance applied once)', async () => {
    const ctx = await fixture('idem-same');
    const firstService = buildService(firstClient);
    const secondService = buildService(secondClient);
    const key = `idem-same-${Date.now()}`;

    const [a, b] = await Promise.all([
      firstService.createTransaction(ctx.tenant.id, ctx.fund.id, ctx.membership.id, ['TENANT_ADMIN'], {
        direction: FundTransactionDirection.CREDIT,
        amountMinor: 50000,
        currencyCode: 'USD',
        occurredAt: new Date().toISOString(),
        idempotencyKey: key,
      }).then((r) => ({ ok: true as const, id: r.id })),
      secondService.createTransaction(ctx.tenant.id, ctx.fund.id, ctx.membership.id, ['TENANT_ADMIN'], {
        direction: FundTransactionDirection.CREDIT,
        amountMinor: 50000,
        currencyCode: 'USD',
        occurredAt: new Date().toISOString(),
        idempotencyKey: key,
      }).then((r) => ({ ok: true as const, id: r.id })),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.id).toBe(b.id);

    const rowCount = await observer.fundTransaction.count({
      where: { tenantId: ctx.tenant.id, fundId: ctx.fund.id, idempotencyKey: key },
    });
    expect(rowCount).toBe(1);

    const balanceRows = await observer.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN "amountMinor" ELSE -"amountMinor" END), 0) AS total
      FROM "FundTransaction" WHERE "fundId" = ${ctx.fund.id} AND "tenantId" = ${ctx.tenant.id}
    `;
    expect(Number(balanceRows[0]?.total ?? 0)).toBe(50000);
  }, 20000);

  it('rejects concurrent different-operation on the same idempotencyKey (ConflictException)', async () => {
    const ctx = await fixture('idem-diff');
    const firstService = buildService(firstClient);
    const secondService = buildService(secondClient);
    const key = `idem-diff-${Date.now()}`;
    const firstAmount = 50000;
    const secondAmount = 99999; // operación materialmente diferente

    // La carrera es indeterminada: exactamente UNO persiste y el otro recibe
    // ConflictException (sin importar quién gane).
    const [a, b] = await Promise.all([
      firstService.createTransaction(ctx.tenant.id, ctx.fund.id, ctx.membership.id, ['TENANT_ADMIN'], {
        direction: FundTransactionDirection.CREDIT,
        amountMinor: firstAmount,
        currencyCode: 'USD',
        occurredAt: new Date().toISOString(),
        idempotencyKey: key,
      }).then(
        (r) => ({ ok: true as const, id: r.id, amount: firstAmount }),
        (error: unknown) => ({
          ok: false as const,
          conflict: error instanceof Error && error.message.includes('idempotencyKey'),
        }),
      ),
      secondService.createTransaction(ctx.tenant.id, ctx.fund.id, ctx.membership.id, ['TENANT_ADMIN'], {
        direction: FundTransactionDirection.CREDIT,
        amountMinor: secondAmount,
        currencyCode: 'USD',
        occurredAt: new Date().toISOString(),
        idempotencyKey: key,
      }).then(
        (r) => ({ ok: true as const, id: r.id, amount: secondAmount }),
        (error: unknown) => ({
          ok: false as const,
          conflict: error instanceof Error && error.message.includes('idempotencyKey'),
        }),
      ),
    ]);

    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.conflict).toBe(true);

    const rowCount = await observer.fundTransaction.count({
      where: { tenantId: ctx.tenant.id, fundId: ctx.fund.id, idempotencyKey: key },
    });
    expect(rowCount).toBe(1);

    // El balance refleja exactamente el monto de la operación ganadora.
    const balanceRows = await observer.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN "amountMinor" ELSE -"amountMinor" END), 0) AS total
      FROM "FundTransaction" WHERE "fundId" = ${ctx.fund.id} AND "tenantId" = ${ctx.tenant.id}
    `;
    const balance = Number(balanceRows[0]?.total ?? 0);
    expect([firstAmount, secondAmount]).toContain(balance);
  }, 20000);

  it('enforces amountMinor > 0 at the database level', async () => {
    const ctx = await fixture('amount-minor');
    const base = {
      tenantId: ctx.tenant.id,
      fundId: ctx.fund.id,
      direction: FundTransactionDirection.CREDIT,
      currencyCode: 'USD',
      occurredAt: new Date(),
      createdByMembershipId: ctx.membership.id,
    } as const;

    await expect(
      observer.fundTransaction.create({ data: { ...base, amountMinor: 0 } }),
    ).rejects.toThrow(/check constraint|Check|amountMinor/);
    await expect(
      observer.fundTransaction.create({ data: { ...base, amountMinor: -1 } }),
    ).rejects.toThrow(/check constraint|Check|amountMinor/);
    await observer.fundTransaction.create({ data: { ...base, amountMinor: 1 } });
    expect(
      await observer.fundTransaction.count({ where: { fundId: ctx.fund.id } }),
    ).toBe(1);
  }, 20000);

  it('enforces the fund scope invariant (TENANT⇒null, BUILDING⇒not-null) at the database level', async () => {
    const ctx = await fixture('scope-invariant');

    // TENANT con buildingId → rechazado por DB
    const building = await observer.building.create({
      data: { tenantId: ctx.tenant.id, name: `S-${Date.now()}`, alias: `S-${Date.now()}`, address: 'x' },
    });
    await expect(
      observer.fund.create({
        data: {
          tenantId: ctx.tenant.id,
          buildingId: building.id,
          scopeType: 'TENANT',
          type: 'RESERVE',
          name: `Invalid TENANT ${Date.now()}`,
          createdByMembershipId: ctx.membership.id,
        },
      }),
    ).rejects.toThrow(/check constraint|Check|scope/);

    // BUILDING sin buildingId → rechazado por DB
    await expect(
      observer.fund.create({
        data: {
          tenantId: ctx.tenant.id,
          scopeType: 'BUILDING',
          type: 'RESERVE',
          name: `Invalid BUILDING ${Date.now()}`,
          createdByMembershipId: ctx.membership.id,
        },
      }),
    ).rejects.toThrow(/check constraint|Check|scope/);

    // BUILDING con buildingId → permitido (fixture ya creó 1 fund TENANT)
    await observer.fund.create({
      data: {
        tenantId: ctx.tenant.id,
        buildingId: building.id,
        scopeType: 'BUILDING',
        type: 'RESERVE',
        name: `Valid BUILDING ${Date.now()}`,
        createdByMembershipId: ctx.membership.id,
      },
    });
    expect(
      await observer.fund.count({ where: { tenantId: ctx.tenant.id } }),
    ).toBe(2); // 1 fixture TENANT + 1 BUILDING válido
  }, 20000);

  it('rolls back Fund creation when the required FUND_CREATE audit fails', async () => {
    const ctx = await fixture('audit-create-rollback');
    const failingService = buildServiceWithFailingAudit(firstClient);
    const name = `Audit Rollback ${Date.now()}`;

    await expect(
      failingService.createFund(ctx.tenant.id, ctx.membership.id, ['TENANT_ADMIN'], {
        scopeType: 'TENANT',
        type: 'RESERVE',
        name,
      }),
    ).rejects.toThrow('FORCED_AUDIT_FAILURE');

    // El Fund NO debe persistir: rollback real del create dentro del tx.
    const count = await observer.fund.count({
      where: { tenantId: ctx.tenant.id, name },
    });
    expect(count).toBe(0);
  }, 20000);

  it('rolls back Fund metadata changes when the required FUND_UPDATE audit fails', async () => {
    const ctx = await fixture('audit-update-rollback');
    const originalName = `Reserva original ${Date.now()}`;
    const fund = await observer.fund.create({
      data: {
        tenantId: ctx.tenant.id,
        scopeType: 'TENANT',
        type: 'RESERVE',
        name: originalName,
        createdByMembershipId: ctx.membership.id,
      },
    });

    const failingService = buildServiceWithFailingAudit(firstClient);
    await expect(
      failingService.updateFund(ctx.tenant.id, fund.id, ctx.membership.id, ['TENANT_ADMIN'], {
        name: 'Reserva modificada',
      }),
    ).rejects.toThrow('FORCED_AUDIT_FAILURE');

    // El name original debe persistir: rollback real del update dentro del tx.
    const after = await observer.fund.findUniqueOrThrow({ where: { id: fund.id } });
    expect(after.name).toBe(originalName);
    expect(after.name).not.toBe('Reserva modificada');
  }, 20000);
});
