import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FundStatus, FundTransactionDirection, Prisma } from '@prisma/client';
import { FundsService } from './funds.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';

const makeFund = (overrides: Record<string, unknown> = {}) => ({
  id: 'fund-1',
  tenantId: 'tenant-1',
  buildingId: null,
  scopeType: 'TENANT',
  type: 'RESERVE',
  name: 'Fondo de reserva',
  description: null,
  status: FundStatus.ACTIVE,
  createdByMembershipId: 'member-1',
  archivedByMembershipId: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeTransaction = (overrides: Record<string, unknown> = {}) => ({
  id: 'tx-1',
  tenantId: 'tenant-1',
  fundId: 'fund-1',
  direction: FundTransactionDirection.CREDIT,
  amountMinor: 50000,
  currencyCode: 'USD',
  occurredAt: new Date('2026-08-14T00:00:00.000Z'),
  description: null,
  createdByMembershipId: 'member-1',
  idempotencyKey: null,
  reversalOfTransactionId: null,
  createdAt: new Date(),
  ...overrides,
});

describe('FundsService', () => {
  let service: FundsService;
  let prisma: PrismaService;
  let audit: AuditService;
  let validators: FinanzasValidators;

  const prismaValue = {
    fund: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    fundTransaction: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      groupBy: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };

  /**
   * Configura groupBy para simular el ledger (créditos luego débitos).
   * @param credits filas CREDIT (currencyCode, _sum.amountMinor)
   * @param debits filas DEBIT (currencyCode, _sum.amountMinor)
   */
  function mockLedger(
    credits: Array<{ currencyCode: string; amountMinor: number }> = [],
    debits: Array<{ currencyCode: string; amountMinor: number }> = [],
  ) {
    (prismaValue.fundTransaction.groupBy as jest.Mock)
      .mockResolvedValueOnce(
        credits.map((c) => ({ currencyCode: c.currencyCode, _sum: { amountMinor: c.amountMinor } })),
      )
      .mockResolvedValueOnce(
        debits.map((d) => ({ currencyCode: d.currencyCode, _sum: { amountMinor: d.amountMinor } })),
      );
  }

  /**
   * Configura groupBy para loadBalancesForFunds (agrupa por fundId + currency).
   */
  function mockBalancesByFund(
    credits: Array<{ fundId: string; currencyCode: string; amountMinor: number }> = [],
    debits: Array<{ fundId: string; currencyCode: string; amountMinor: number }> = [],
  ) {
    (prismaValue.fundTransaction.groupBy as jest.Mock)
      .mockResolvedValueOnce(
        credits.map((c) => ({ fundId: c.fundId, currencyCode: c.currencyCode, _sum: { amountMinor: c.amountMinor } })),
      )
      .mockResolvedValueOnce(
        debits.map((d) => ({ fundId: d.fundId, currencyCode: d.currencyCode, _sum: { amountMinor: d.amountMinor } })),
      );
  }

  /**
   * Makes $transaction(callback) execute the callback with a tx client backed
   * by the same jest mocks (simulates the real transaction boundary).
   */
  function mockTransaction() {
    const tx = {
      fund: prismaValue.fund,
      fundTransaction: prismaValue.fundTransaction,
      auditLog: { create: jest.fn() },
      $queryRaw: prismaValue.$queryRaw,
      $executeRaw: prismaValue.$executeRaw,
    };
    (prismaValue.$transaction as jest.Mock).mockImplementation(
      async (callback: (tx: typeof tx) => unknown) => callback(tx),
    );
    return tx;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    // mockReset vacía las colas de mockResolvedValueOnce/mockRejectedValueOnce
    // que clearAllMocks no toca
    (prismaValue.fundTransaction.groupBy as jest.Mock).mockReset();
    (prismaValue.fundTransaction.create as jest.Mock).mockReset();
    mockTransaction();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FundsService,
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
          useValue: {
            isAdminOrOperator: jest.fn().mockReturnValue(true),
            validateBuildingBelongsToTenant: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<FundsService>(FundsService);
    prisma = module.get<PrismaService>(PrismaService);
    audit = module.get<AuditService>(AuditService);
    validators = module.get<FinanzasValidators>(FinanzasValidators);

    (validators.isAdminOrOperator as jest.Mock).mockReturnValue(true);
    (validators.validateBuildingBelongsToTenant as jest.Mock).mockResolvedValue(undefined);
    (audit.createLogRequired as jest.Mock).mockResolvedValue(undefined);
  });

  const roles = ['TENANT_ADMIN'];

  // ── RBAC ────────────────────────────────────────────────────────────────

  describe('RBAC', () => {
    it('rejects non-admin users on every operation', async () => {
      (validators.isAdminOrOperator as jest.Mock).mockReturnValue(false);
      const denied = [
        () => service.listFunds('tenant-1', ['RESIDENT']),
        () => service.getFund('tenant-1', 'fund-1', ['RESIDENT']),
        () => service.createFund('tenant-1', 'm', ['RESIDENT'], {
          scopeType: 'TENANT', type: 'RESERVE', name: 'X',
        }),
        () => service.updateFund('tenant-1', 'fund-1', 'm', ['RESIDENT'], { name: 'Y' }),
        () => service.archiveFund('tenant-1', 'fund-1', 'm', ['RESIDENT']),
        () => service.listTransactions('tenant-1', 'fund-1', ['RESIDENT']),
        () => service.createTransaction('tenant-1', 'fund-1', 'm', ['RESIDENT'], {
          direction: FundTransactionDirection.CREDIT, amountMinor: 100, currencyCode: 'USD', occurredAt: '2026-08-14T00:00:00.000Z',
        }),
        () => service.reverseTransaction('tenant-1', 'fund-1', 'tx-1', 'm', ['RESIDENT']),
      ];
      for (const call of denied) {
        await expect(call()).rejects.toThrow(ForbiddenException);
      }
    });
  });

  // ── Fund CRUD ───────────────────────────────────────────────────────────

  describe('createFund', () => {
    it('creates a TENANT fund with no building', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fund.create as jest.Mock).mockResolvedValue(makeFund());

      const result = await service.createFund('tenant-1', 'member-1', roles, {
        scopeType: 'TENANT',
        type: 'RESERVE',
        name: '  Fondo de reserva  ',
      });

      expect(result.scopeType).toBe('TENANT');
      expect(result.buildingId).toBeNull();
      expect(result.name).toBe('Fondo de reserva');
      expect(prisma.fund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            buildingId: null,
            status: FundStatus.ACTIVE,
          }),
        }),
      );
      expect(audit.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FUND_CREATE', entityId: 'fund-1' }),
        expect.anything(),
      );
    });

    it('creates a BUILDING fund and validates the building belongs to tenant', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fund.create as jest.Mock).mockResolvedValue(
        makeFund({ buildingId: 'building-1', scopeType: 'BUILDING' }),
      );

      await service.createFund('tenant-1', 'member-1', roles, {
        scopeType: 'BUILDING',
        buildingId: 'building-1',
        type: 'SPECIAL',
        name: 'Fondo ascensores',
      });

      expect(validators.validateBuildingBelongsToTenant).toHaveBeenCalledWith(
        'tenant-1',
        'building-1',
      );
      expect(prisma.fund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ buildingId: 'building-1' }),
        }),
      );
    });

    it('rejects TENANT fund with a buildingId', async () => {
      await expect(
        service.createFund('tenant-1', 'member-1', roles, {
          scopeType: 'TENANT',
          buildingId: 'building-1',
          type: 'RESERVE',
          name: 'X',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects BUILDING fund without buildingId', async () => {
      await expect(
        service.createFund('tenant-1', 'member-1', roles, {
          scopeType: 'BUILDING',
          type: 'RESERVE',
          name: 'X',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a building from another tenant', async () => {
      (validators.validateBuildingBelongsToTenant as jest.Mock).mockRejectedValue(
        new NotFoundException('Building not found or does not belong to this tenant'),
      );
      await expect(
        service.createFund('tenant-1', 'member-1', roles, {
          scopeType: 'BUILDING',
          buildingId: 'building-other',
          type: 'RESERVE',
          name: 'X',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects duplicate active name in the same scope (case/space-insensitive)', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([
        makeFund({ name: 'Fondo reserva' }),
      ]);
      await expect(
        service.createFund('tenant-1', 'member-1', roles, {
          scopeType: 'TENANT',
          type: 'RESERVE',
          name: '  fondo  reserva ',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows the same name in a different building', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fund.create as jest.Mock).mockResolvedValue(
        makeFund({ id: 'fund-b1', buildingId: 'building-1', scopeType: 'BUILDING' }),
      );

      await service.createFund('tenant-1', 'member-1', roles, {
        scopeType: 'BUILDING',
        buildingId: 'building-1',
        type: 'RESERVE',
        name: 'Fondo de reserva',
      });
      expect(prisma.fund.create).toHaveBeenCalledTimes(1);
    });

    it('allows reusing a name of an ARCHIVED fund', async () => {
      // El servicio filtra status=ACTIVE en la query; el mock respeta el filtro
      (prisma.fund.findMany as jest.Mock).mockImplementation(({ where }) =>
        Promise.resolve(
          where.status === FundStatus.ACTIVE
            ? []
            : [makeFund({ name: 'Fondo de reserva', status: FundStatus.ARCHIVED })],
        ),
      );
      (prisma.fund.create as jest.Mock).mockResolvedValue(makeFund({ id: 'fund-2' }));

      const result = await service.createFund('tenant-1', 'member-1', roles, {
        scopeType: 'TENANT',
        type: 'RESERVE',
        name: 'Fondo de reserva',
      });
      expect(result.id).toBe('fund-2');
    });

    it('turns a DB unique race on active name into ConflictException (P2002 Fund_active_name_*)', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fund.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['Fund_active_name_tenant_key'] },
        }),
      );

      await expect(
        service.createFund('tenant-1', 'member-1', roles, {
          scopeType: 'TENANT',
          type: 'RESERVE',
          name: 'Fondo de reserva',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rethrows a P2002 that is not the active-name index', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fund.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['Fund_some_other_key'] },
        }),
      );

      await expect(
        service.createFund('tenant-1', 'member-1', roles, {
          scopeType: 'TENANT',
          type: 'RESERVE',
          name: 'Fondo de reserva',
        }),
      ).rejects.toThrow('unique violation');
    });
  });

  describe('listFunds / getFund', () => {
    it('lists funds tenant-scoped with filters and computed balances', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([
        makeFund(),
        makeFund({ id: 'fund-2', name: 'Fondo ascensores' }),
      ]);
      mockBalancesByFund(
        [{ fundId: 'fund-1', currencyCode: 'USD', amountMinor: 50000 }],
        [{ fundId: 'fund-1', currencyCode: 'USD', amountMinor: 20000 }],
      );

      const result = await service.listFunds('tenant-1', roles, { status: 'ACTIVE' });

      expect(prisma.fund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-1', status: 'ACTIVE' }),
        }),
      );
      expect(result[0]!.balancesByCurrency).toEqual([
        { currency: 'USD', amountMinor: 30000 },
      ]);
    });

    it('rejects getFund of a fund from another tenant', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.getFund('tenant-1', 'fund-other', roles),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.fund.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'fund-other', tenantId: 'tenant-1' } }),
      );
    });
  });

  describe('updateFund', () => {
    it('updates safe metadata only (name/description)', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fund.update as jest.Mock).mockResolvedValue(
        makeFund({ name: 'Nuevo nombre' }),
      );
      mockLedger([], []);

      const result = await service.updateFund('tenant-1', 'fund-1', 'member-1', roles, {
        name: 'Nuevo nombre',
      });

      expect(result.name).toBe('Nuevo nombre');
      expect(prisma.fund.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ tenantId: expect.anything() }),
        }),
      );
      expect(audit.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FUND_UPDATE' }),
        expect.anything(),
      );
    });

    it('rejects update of a fund from another tenant', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.updateFund('tenant-1', 'fund-other', 'member-1', roles, { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('turns a DB unique race on rename into ConflictException (P2002 Fund_active_name_*)', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fund.update as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['Fund_active_name_building_key'] },
        }),
      );

      await expect(
        service.updateFund('tenant-1', 'fund-1', 'member-1', roles, { name: 'X' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('archiveFund', () => {
    it('archives a fund with zero balance', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      mockLedger([], []);
      (prisma.fund.update as jest.Mock).mockResolvedValue(
        makeFund({ status: FundStatus.ARCHIVED, archivedAt: new Date() }),
      );

      const result = await service.archiveFund('tenant-1', 'fund-1', 'member-1', roles);
      expect(result.status).toBe(FundStatus.ARCHIVED);
      expect(audit.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FUND_ARCHIVE' }),
        expect.anything(),
      );
    });

    it('rejects archive of a fund with non-zero balance', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      mockLedger([{ currencyCode: 'USD', amountMinor: 50000 }], []);

      await expect(
        service.archiveFund('tenant-1', 'fund-1', 'member-1', roles),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── Ledger: CREDIT / DEBIT / multicurrency / insufficient ───────────────

  describe('createTransaction', () => {
    it('credits increase the balance', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      mockLedger([], []);
      (prisma.fundTransaction.create as jest.Mock).mockResolvedValue(
        makeTransaction({ direction: FundTransactionDirection.CREDIT, amountMinor: 50000 }),
      );

      const result = await service.createTransaction('tenant-1', 'fund-1', 'member-1', roles, {
        direction: FundTransactionDirection.CREDIT,
        amountMinor: 50000,
        currencyCode: 'USD',
        occurredAt: '2026-08-14T00:00:00.000Z',
      });

      expect(result.amountMinor).toBe(50000);
      expect(prisma.fundTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fundId: 'fund-1',
            direction: FundTransactionDirection.CREDIT,
            amountMinor: 50000,
            currencyCode: 'USD',
          }),
        }),
      );
      expect(audit.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FUND_TRANSACTION_CREATE' }),
        expect.anything(),
      );
    });

    it('debit reduces the balance when sufficient', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      mockLedger([{ currencyCode: 'USD', amountMinor: 50000 }], []);
      (prisma.fundTransaction.create as jest.Mock).mockResolvedValue(
        makeTransaction({ direction: FundTransactionDirection.DEBIT, amountMinor: 20000 }),
      );

      const result = await service.createTransaction('tenant-1', 'fund-1', 'member-1', roles, {
        direction: FundTransactionDirection.DEBIT,
        amountMinor: 20000,
        currencyCode: 'USD',
        occurredAt: '2026-08-14T00:00:00.000Z',
      });
      expect(result.direction).toBe(FundTransactionDirection.DEBIT);
    });

    it('rejects debit exceeding balance (no negative balance)', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      mockLedger([{ currencyCode: 'USD', amountMinor: 10000 }], []);

      await expect(
        service.createTransaction('tenant-1', 'fund-1', 'member-1', roles, {
          direction: FundTransactionDirection.DEBIT,
          amountMinor: 10100,
          currencyCode: 'USD',
          occurredAt: '2026-08-14T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    });

    it('keeps balances independent per currency', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      mockLedger(
        [{ currencyCode: 'USD', amountMinor: 10000 }, { currencyCode: 'COP', amountMinor: 50000000 }],
        [],
      );
      (prisma.fundTransaction.create as jest.Mock).mockResolvedValue(
        makeTransaction({ direction: FundTransactionDirection.DEBIT, amountMinor: 1000000, currencyCode: 'COP' }),
      );

      await service.createTransaction('tenant-1', 'fund-1', 'member-1', roles, {
        direction: FundTransactionDirection.DEBIT,
        amountMinor: 1000000,
        currencyCode: 'COP',
        occurredAt: '2026-08-14T00:00:00.000Z',
      });
      // debit 1.000.000 COP <= balance 50.000.000 COP → ok (independiente de USD)
      expect(prisma.fundTransaction.create).toHaveBeenCalledTimes(1);
    });

    it('rejects transaction on an archived fund', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(
        makeFund({ status: FundStatus.ARCHIVED }),
      );
      await expect(
        service.createTransaction('tenant-1', 'fund-1', 'member-1', roles, {
          direction: FundTransactionDirection.CREDIT,
          amountMinor: 100,
          currencyCode: 'USD',
          occurredAt: '2026-08-14T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transaction on a fund from another tenant', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.createTransaction('tenant-1', 'fund-other', 'member-1', roles, {
          direction: FundTransactionDirection.CREDIT,
          amountMinor: 100,
          currencyCode: 'USD',
          occurredAt: '2026-08-14T00:00:00.000Z',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Idempotency ─────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('returns the existing transaction when the same idempotency key repeats', async () => {
      const existing = makeTransaction({
        id: 'tx-existing',
        idempotencyKey: 'income-app-1',
      });
      (prisma.fundTransaction.findUnique as jest.Mock).mockResolvedValue(existing);

      const result = await service.createTransaction('tenant-1', 'fund-1', 'member-1', roles, {
        direction: FundTransactionDirection.CREDIT,
        amountMinor: 50000,
        currencyCode: 'USD',
        occurredAt: '2026-08-14T00:00:00.000Z',
        idempotencyKey: 'income-app-1',
      });

      expect(result.id).toBe('tx-existing');
      expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects the same key with a different operation (CONFLICT)', async () => {
      (prisma.fundTransaction.findUnique as jest.Mock).mockResolvedValue(
        makeTransaction({ idempotencyKey: 'key-1', amountMinor: 100 }),
      );
      await expect(
        service.createTransaction('tenant-1', 'fund-1', 'member-1', roles, {
          direction: FundTransactionDirection.CREDIT,
          amountMinor: 999,
          currencyCode: 'USD',
          occurredAt: '2026-08-14T00:00:00.000Z',
          idempotencyKey: 'key-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('recovers from a P2002 unique race by returning the existing transaction', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      mockLedger([], []);
      // Pre-check (findUnique inicial) → miss; luego el create choca con el unique
      (prisma.fundTransaction.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          makeTransaction({
            id: 'tx-winner',
            idempotencyKey: 'key-race',
            amountMinor: 50000,
          }),
        );
      (prisma.fundTransaction.create as jest.Mock).mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['FundTransaction_tenantId_idempotencyKey_key'] },
        }),
      );

      const result = await service.createTransaction('tenant-1', 'fund-1', 'member-1', roles, {
        direction: FundTransactionDirection.CREDIT,
        amountMinor: 50000,
        currencyCode: 'USD',
        occurredAt: '2026-08-14T00:00:00.000Z',
        idempotencyKey: 'key-race',
      });

      expect(result.id).toBe('tx-winner');
      expect(prisma.fundTransaction.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  // ── Reversal ────────────────────────────────────────────────────────────

  describe('reverseTransaction', () => {
    it('reverses a CREDIT with an opposite DEBIT of the same amount/currency', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      (prisma.fundTransaction.findFirst as jest.Mock).mockResolvedValue(
        makeTransaction({ direction: FundTransactionDirection.CREDIT, amountMinor: 50000 }),
      );
      (prisma.fundTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      mockLedger([{ currencyCode: 'USD', amountMinor: 50000 }], []);
      (prisma.fundTransaction.create as jest.Mock).mockResolvedValue(
        makeTransaction({
          id: 'tx-reversal',
          direction: FundTransactionDirection.DEBIT,
          amountMinor: 50000,
          reversalOfTransactionId: 'tx-1',
        }),
      );

      const result = await service.reverseTransaction('tenant-1', 'fund-1', 'tx-1', 'member-1', roles);

      expect(result.direction).toBe(FundTransactionDirection.DEBIT);
      expect(result.amountMinor).toBe(50000);
      expect(result.reversalOfTransactionId).toBe('tx-1');
      expect(prisma.fundTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reversalOfTransactionId: 'tx-1',
            currencyCode: 'USD',
            amountMinor: 50000,
          }),
        }),
      );
      expect(audit.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FUND_TRANSACTION_REVERSE' }),
        expect.anything(),
      );
    });

    it('rejects reversing a transaction twice', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      (prisma.fundTransaction.findFirst as jest.Mock).mockResolvedValue(
        makeTransaction({ direction: FundTransactionDirection.CREDIT, amountMinor: 50000 }),
      );
      (prisma.fundTransaction.findUnique as jest.Mock).mockResolvedValue(
        makeTransaction({ id: 'tx-reversal', reversalOfTransactionId: 'tx-1' }),
      );

      await expect(
        service.reverseTransaction('tenant-1', 'fund-1', 'tx-1', 'member-1', roles),
      ).rejects.toThrow(ConflictException);
      expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects reversing a transaction that is itself a reversal', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      (prisma.fundTransaction.findFirst as jest.Mock).mockResolvedValue(
        makeTransaction({ reversalOfTransactionId: 'tx-0' }),
      );

      await expect(
        service.reverseTransaction('tenant-1', 'fund-1', 'tx-1', 'member-1', roles),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects reversing a transaction from another tenant/fund', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      (prisma.fundTransaction.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.reverseTransaction('tenant-1', 'fund-1', 'tx-other', 'member-1', roles),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a credit reversal (→ DEBIT) that would make the balance negative', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      (prisma.fundTransaction.findFirst as jest.Mock).mockResolvedValue(
        makeTransaction({ direction: FundTransactionDirection.CREDIT, amountMinor: 50000 }),
      );
      (prisma.fundTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      mockLedger([{ currencyCode: 'USD', amountMinor: 30000 }], []);

      await expect(
        service.reverseTransaction('tenant-1', 'fund-1', 'tx-1', 'member-1', roles),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects reversal on an archived fund', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(
        makeFund({ status: FundStatus.ARCHIVED }),
      );
      await expect(
        service.reverseTransaction('tenant-1', 'fund-1', 'tx-1', 'member-1', roles),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Tenant isolation ────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('never queries without tenantId scope', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fundTransaction.groupBy as jest.Mock).mockResolvedValue([]);

      await service.listFunds('tenant-1', roles);

      expect(
        (prisma.fund.findMany as jest.Mock).mock.calls.every(
          ([query]) => query.where.tenantId === 'tenant-1',
        ),
      ).toBe(true);
    });

    it('scopes transactions listing to tenantId + fundId', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      (prisma.fundTransaction.findMany as jest.Mock).mockResolvedValue([]);

      await service.listTransactions('tenant-1', 'fund-1', roles);

      expect(prisma.fundTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', fundId: 'fund-1' },
        }),
      );
    });
  });

  // ── Audit atomicity ─────────────────────────────────────────────────────

  describe('audit atomicity', () => {
    it('audits FUND_TRANSACTION_CREATE with createLogRequired (same-tx boundary)', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      mockLedger([], []);
      (prisma.fundTransaction.create as jest.Mock).mockResolvedValue(
        makeTransaction(),
      );

      await service.createTransaction('tenant-1', 'fund-1', 'member-1', roles, {
        direction: FundTransactionDirection.CREDIT,
        amountMinor: 50000,
        currencyCode: 'USD',
        occurredAt: '2026-08-14T00:00:00.000Z',
      });

      expect(audit.createLogRequired).toHaveBeenCalledTimes(1);
      expect(audit.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FUND_TRANSACTION_CREATE' }),
        expect.anything(),
      );
    });

    it('createFund writes FUND_CREATE audit with the transaction client', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fund.create as jest.Mock).mockResolvedValue(makeFund());

      await service.createFund('tenant-1', 'member-1', roles, {
        scopeType: 'TENANT',
        type: 'RESERVE',
        name: 'Fondo de reserva',
      });

      expect(audit.createLogRequired).toHaveBeenCalledTimes(1);
      expect(audit.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FUND_CREATE', entityId: 'fund-1' }),
        expect.anything(),
      );
    });

    it('createFund propagates the error when the required audit fails', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fund.create as jest.Mock).mockResolvedValue(makeFund());
      (audit.createLogRequired as jest.Mock).mockRejectedValue(
        new Error('FORCED_AUDIT_FAILURE'),
      );

      await expect(
        service.createFund('tenant-1', 'member-1', roles, {
          scopeType: 'TENANT',
          type: 'RESERVE',
          name: 'Fondo de reserva',
        }),
      ).rejects.toThrow('FORCED_AUDIT_FAILURE');
      // el fund.create se ejecutó dentro del tx, pero el error debe propagarse
      // (el rollback real lo demuestra el test PostgreSQL)
    });

    it('updateFund writes FUND_UPDATE audit with the transaction client', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fund.update as jest.Mock).mockResolvedValue(
        makeFund({ name: 'Nuevo nombre' }),
      );
      mockLedger([], []);

      await service.updateFund('tenant-1', 'fund-1', 'member-1', roles, {
        name: 'Nuevo nombre',
      });

      expect(audit.createLogRequired).toHaveBeenCalledTimes(1);
      expect(audit.createLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FUND_UPDATE' }),
        expect.anything(),
      );
    });

    it('updateFund propagates the error when the required audit fails', async () => {
      (prisma.fund.findFirst as jest.Mock).mockResolvedValue(makeFund());
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fund.update as jest.Mock).mockResolvedValue(
        makeFund({ name: 'Nuevo nombre' }),
      );
      (audit.createLogRequired as jest.Mock).mockRejectedValue(
        new Error('FORCED_AUDIT_FAILURE'),
      );

      await expect(
        service.updateFund('tenant-1', 'fund-1', 'member-1', roles, {
          name: 'Nuevo nombre',
        }),
      ).rejects.toThrow('FORCED_AUDIT_FAILURE');
    });
  });
});
