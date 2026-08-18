import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, FundStatus, FundTransactionDirection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import {
  CreateFundDto,
  UpdateFundDto,
  FundQueryDto,
  FundResponseDto,
  CreateFundTransactionDto,
  ReverseFundTransactionDto,
  FundTransactionResponseDto,
} from './funds.dto';
import {
  acquireFundLock,
} from './fund-locks';
import { assertSufficientFundBalance } from './fund-ledger';

type FundWithBalance = Prisma.FundGetPayload<Record<string, never>> & {
  balancesByCurrency: Array<{ currency: string; amountMinor: number }>;
};

@Injectable()
export class FundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────

  async listFunds(
    tenantId: string,
    userRoles: string[],
    query: FundQueryDto = {},
  ): Promise<FundResponseDto[]> {
    this.assertAdminOrOperator(userRoles, 'ver fondos');

    const funds = await this.prisma.fund.findMany({
      where: {
        tenantId,
        ...(query.buildingId ? { buildingId: query.buildingId } : {}),
        ...(query.scopeType ? { scopeType: query.scopeType } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    const balances = await this.loadBalancesForFunds(tenantId, funds.map((f) => f.id));

    return funds.map((fund) =>
      this.toFundDto(fund, balances.get(fund.id) ?? []),
    );
  }

  async getFund(
    tenantId: string,
    fundId: string,
    userRoles: string[],
  ): Promise<FundResponseDto> {
    this.assertAdminOrOperator(userRoles, 'ver fondos');

    const fund = await this.prisma.fund.findFirst({
      where: { id: fundId, tenantId },
    });
    if (!fund) {
      throw new NotFoundException('Fondo no encontrado o no pertenece al tenant');
    }

    const balances = await this.loadBalancesForFunds(tenantId, [fund.id]);
    return this.toFundDto(fund, balances.get(fund.id) ?? []);
  }

  async createFund(
    tenantId: string,
    membershipId: string,
    userRoles: string[],
    dto: CreateFundDto,
  ): Promise<FundResponseDto> {
    this.assertAdminOrOperator(userRoles, 'crear fondos');

    await this.assertScopeInvariant(tenantId, dto.scopeType, dto.buildingId);

    // Nombre duplicado activo dentro del mismo scope (case/space-insensitive)
    await this.assertNoActiveDuplicateName(
      tenantId,
      dto.scopeType,
      dto.buildingId ?? null,
      dto.name,
    );

    let fund: Prisma.FundGetPayload<Record<string, never>>;
    try {
      // Fund.create + FUND_CREATE audit en la MISMA transacción (ALL OR NOTHING).
      // Si el audit falla, el Fund no persiste.
      fund = await this.prisma.$transaction(async (tx) => {
        const created = await tx.fund.create({
          data: {
            tenantId,
            buildingId: dto.scopeType === 'BUILDING' ? dto.buildingId : null,
            scopeType: dto.scopeType,
            type: dto.type,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            status: FundStatus.ACTIVE,
            createdByMembershipId: membershipId,
          },
        });

        await this.auditService.createLogRequired(
          {
            tenantId,
            actorMembershipId: membershipId,
            action: 'FUND_CREATE',
            entityType: 'Fund',
            entityId: created.id,
            metadata: {
              scopeType: dto.scopeType,
              ...(created.buildingId !== null
                ? { buildingId: created.buildingId }
                : {}),
              type: dto.type,
              name: created.name,
            },
          },
          tx,
        );

        return created;
      });
    } catch (error) {
      // Race de nombre activo (unique parcial Fund_active_name_*): otra request
      // creó un fondo activo con el mismo nombre normalizado en el mismo scope.
      // El unique violation aborta el tx; se captura FUERA de la transacción.
      if (this.isActiveNameUniqueViolation(error)) {
        throw new ConflictException(
          'Ya existe un fondo activo con el mismo nombre en este alcance',
        );
      }
      throw error;
    }

    return this.toFundDto(fund, []);
  }

  async updateFund(
    tenantId: string,
    fundId: string,
    membershipId: string,
    userRoles: string[],
    dto: UpdateFundDto,
  ): Promise<FundResponseDto> {
    this.assertAdminOrOperator(userRoles, 'editar fondos');

    const fund = await this.prisma.fund.findFirst({
      where: { id: fundId, tenantId },
    });
    if (!fund) {
      throw new NotFoundException('Fondo no encontrado o no pertenece al tenant');
    }

    if (dto.name !== undefined && dto.name !== fund.name) {
      await this.assertNoActiveDuplicateName(
        tenantId,
        fund.scopeType,
        fund.buildingId,
        dto.name,
        { excludeFundId: fund.id },
      );
    }

    let updated: Prisma.FundGetPayload<Record<string, never>>;
    try {
      // fund.update + FUND_UPDATE audit en la MISMA transacción (ALL OR NOTHING).
      // Si el audit falla, name/description hacen rollback.
      updated = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.fund.update({
          where: { id: fund.id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined
              ? { description: dto.description?.trim() || null }
              : {}),
          },
        });

        await this.auditService.createLogRequired(
          {
            tenantId,
            actorMembershipId: membershipId,
            action: 'FUND_UPDATE',
            entityType: 'Fund',
            entityId: fund.id,
            metadata: {
              before: { name: fund.name },
              after: { name: changed.name },
            },
          },
          tx,
        );

        return changed;
      });
    } catch (error) {
      if (this.isActiveNameUniqueViolation(error)) {
        throw new ConflictException(
          'Ya existe un fondo activo con el mismo nombre en este alcance',
        );
      }
      throw error;
    }

    const balances = await this.loadBalancesForFunds(tenantId, [updated.id]);
    return this.toFundDto(updated, balances.get(updated.id) ?? []);
  }

  async archiveFund(
    tenantId: string,
    fundId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<FundResponseDto> {
    this.assertAdminOrOperator(userRoles, 'archivar fondos');

    return this.prisma.$transaction(async (tx) => {
      // Mismo advisory lock que createTransaction/reverseTransaction: serializa
      // la transición ACTIVE→ARCHIVED contra mutaciones de saldo (evita
      // archivar un fondo con saldo no cero creado por un CREDIT concurrente).
      await acquireFundLock(tx, tenantId, fundId);

      const fund = await tx.fund.findFirst({
        where: { id: fundId, tenantId },
      });
      if (!fund) {
        throw new NotFoundException('Fondo no encontrado o no pertenece al tenant');
      }
      if (fund.status === FundStatus.ARCHIVED) {
        throw new BadRequestException('El fondo ya está archivado');
      }

      const balances = await this.computeBalances(tx, tenantId, fundId);
      const nonZero = balances.filter((b) => b.amountMinor !== 0);
      if (nonZero.length > 0) {
        throw new ConflictException(
          'No se puede archivar un fondo con saldo distinto de cero',
        );
      }

      const archived = await tx.fund.update({
        where: { id: fund.id },
        data: {
          status: FundStatus.ARCHIVED,
          archivedAt: new Date(),
          archivedByMembershipId: membershipId,
        },
      });

      await this.auditService.createLogRequired(
        {
          tenantId,
          actorMembershipId: membershipId,
          action: 'FUND_ARCHIVE',
          entityType: 'Fund',
          entityId: fund.id,
          metadata: { previousStatus: fund.status, newStatus: FundStatus.ARCHIVED },
        },
        tx,
      );

      return this.toFundDto(archived, balances);
    });
  }

  async listTransactions(
    tenantId: string,
    fundId: string,
    userRoles: string[],
    query: { currencyCode?: string; limit?: number; offset?: number } = {},
  ): Promise<FundTransactionResponseDto[]> {
    this.assertAdminOrOperator(userRoles, 'ver movimientos de fondos');

    await this.assertFundInTenant(tenantId, fundId);

    const transactions = await this.prisma.fundTransaction.findMany({
      where: {
        tenantId,
        fundId,
        ...(query.currencyCode ? { currencyCode: query.currencyCode } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: query.limit ?? 100,
      skip: query.offset ?? 0,
    });

    return transactions.map((tx) => this.toTransactionDto(tx));
  }

  async createTransaction(
    tenantId: string,
    fundId: string,
    membershipId: string,
    userRoles: string[],
    dto: CreateFundTransactionDto,
  ): Promise<FundTransactionResponseDto> {
    this.assertAdminOrOperator(userRoles, 'registrar movimientos de fondos');

    // Idempotencia: misma key + mismo tenant => devolver la transacción existente
    if (dto.idempotencyKey) {
      const existing = await this.prisma.fundTransaction.findUnique({
        where: {
          tenantId_idempotencyKey: {
            tenantId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
      });
      if (existing) {
        await this.assertSameOperation(existing, fundId, dto);
        return this.toTransactionDto(existing);
      }
    }

    let transaction: Prisma.FundTransactionGetPayload<Record<string, never>>;
    try {
      transaction = await this.prisma.$transaction(async (tx) => {
        // Advisory lock: serializa balance-guard y creación del movimiento
        await acquireFundLock(tx, tenantId, fundId);

        const fund = await tx.fund.findFirst({
          where: { id: fundId, tenantId },
        });
        if (!fund) {
          throw new NotFoundException('Fondo no encontrado o no pertenece al tenant');
        }
        if (fund.status === FundStatus.ARCHIVED) {
          throw new BadRequestException('No se pueden registrar movimientos en un fondo archivado');
        }

        if (dto.direction === FundTransactionDirection.DEBIT) {
          await this.assertSufficientBalance(tx, tenantId, fundId, dto.currencyCode, dto.amountMinor);
        }

        const created = await tx.fundTransaction.create({
          data: {
            tenantId,
            fundId,
            direction: dto.direction,
            amountMinor: dto.amountMinor,
            currencyCode: dto.currencyCode,
            occurredAt: new Date(dto.occurredAt),
            description: dto.description?.trim() || null,
            createdByMembershipId: membershipId,
            idempotencyKey: dto.idempotencyKey ?? null,
          },
        });

        await this.auditService.createLogRequired(
          {
            tenantId,
            actorMembershipId: membershipId,
            action: 'FUND_TRANSACTION_CREATE',
            entityType: 'FundTransaction',
            entityId: created.id,
            metadata: {
              fundId,
              direction: dto.direction,
              amountMinor: dto.amountMinor,
              currencyCode: dto.currencyCode,
              occurredAt: dto.occurredAt,
              ...(dto.idempotencyKey !== undefined && dto.idempotencyKey !== null
                ? { idempotencyKey: dto.idempotencyKey }
                : {}),
            },
          },
          tx,
        );

        return created;
      });
    } catch (error) {
      // Race de idempotencyKey (unique (tenantId, idempotencyKey)): otra request
      // creó el movimiento entre el pre-check y el create. El unique violation
      // aborta el tx PostgreSQL, así que NO se consulta con el mismo tx.
      // Se deja el tx rollbackear y se consulta FUERA con this.prisma.
      if (
        dto.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.fundTransaction.findUnique({
          where: {
            tenantId_idempotencyKey: {
              tenantId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
        });
        if (winner) {
          await this.assertSameOperation(winner, fundId, dto);
          return this.toTransactionDto(winner);
        }
      }
      throw error;
    }

    return this.toTransactionDto(transaction);
  }

  async reverseTransaction(
    tenantId: string,
    fundId: string,
    transactionId: string,
    membershipId: string,
    userRoles: string[],
    dto: ReverseFundTransactionDto = {},
  ): Promise<FundTransactionResponseDto> {
    this.assertAdminOrOperator(userRoles, 'reversar movimientos de fondos');

    return this.prisma.$transaction(async (tx) => {
      await acquireFundLock(tx, tenantId, fundId);

      const fund = await tx.fund.findFirst({
        where: { id: fundId, tenantId },
      });
      if (!fund) {
        throw new NotFoundException('Fondo no encontrado o no pertenece al tenant');
      }
      if (fund.status === FundStatus.ARCHIVED) {
        throw new BadRequestException('No se pueden reversar movimientos en un fondo archivado');
      }

      const original = await tx.fundTransaction.findFirst({
        where: { id: transactionId, tenantId, fundId },
      });
      if (!original) {
        throw new NotFoundException('Movimiento no encontrado o no pertenece a este fondo');
      }
      if (original.reversalOfTransactionId !== null) {
        throw new ConflictException('No se puede reversar un movimiento que ya es una reversa');
      }
      // FIN-03: un FundTransaction gestionado por IncomeApplication NO puede
      // reversarse por el endpoint genérico de Funds. Su reversa la controla
      // voidIncome (void del Income). Evita desbalancear un plan publicado.
      if (original.incomeApplicationId !== null) {
        throw new ConflictException(
          'Este movimiento pertenece a una aplicación de ingreso; reversar vía void del Income',
        );
      }

      // Una transacción solo puede revertirse una vez (unique + check explícito)
      const existingReversal = await tx.fundTransaction.findUnique({
        where: { reversalOfTransactionId: original.id },
      });
      if (existingReversal) {
        throw new ConflictException('Este movimiento ya fue reversado');
      }

      const reversalDirection =
        original.direction === FundTransactionDirection.CREDIT
          ? FundTransactionDirection.DEBIT
          : FundTransactionDirection.CREDIT;

      // Reversar un CREDIT (→ DEBIT) no puede dejar saldo negativo
      if (reversalDirection === FundTransactionDirection.DEBIT) {
        await this.assertSufficientBalance(
          tx,
          tenantId,
          fundId,
          original.currencyCode,
          original.amountMinor,
        );
      }

      const reversal = await tx.fundTransaction.create({
        data: {
          tenantId,
          fundId,
          direction: reversalDirection,
          amountMinor: original.amountMinor,
          currencyCode: original.currencyCode,
          occurredAt: new Date(),
          description: dto.reason?.trim()
            ? `Reversa de ${original.id}: ${dto.reason.trim()}`
            : `Reversa de ${original.id}`,
          createdByMembershipId: membershipId,
          reversalOfTransactionId: original.id,
        },
      });

      await this.auditService.createLogRequired(
        {
          tenantId,
          actorMembershipId: membershipId,
          action: 'FUND_TRANSACTION_REVERSE',
          entityType: 'FundTransaction',
          entityId: reversal.id,
          metadata: {
            fundId,
            originalTransactionId: original.id,
            direction: reversalDirection,
            amountMinor: original.amountMinor,
            currencyCode: original.currencyCode,
          },
        },
        tx,
      );

      return this.toTransactionDto(reversal);
    });
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private assertAdminOrOperator(userRoles: string[], action: string): void {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(`Solo administradores pueden ${action}`);
    }
  }

  /**
   * Detecta una violación de los unique parciales de nombre activo
   * (Fund_active_name_tenant_key / Fund_active_name_building_key).
   * Prisma 5.x expone meta.target como array de nombres de constraint.
   */
  private isActiveNameUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }
    if (error.code !== 'P2002') {
      return false;
    }
    const target = error.meta?.target;
    const targets = Array.isArray(target) ? target : [target];
    return targets.some(
      (name) =>
        typeof name === 'string' && name.startsWith('Fund_active_name_'),
    );
  }

  private async assertScopeInvariant(
    tenantId: string,
    scopeType: CreateFundDto['scopeType'],
    buildingId?: string,
  ): Promise<void> {
    if (scopeType === 'TENANT') {
      if (buildingId) {
        throw new BadRequestException(
          'Un fondo TENANT no puede tener buildingId',
        );
      }
      return;
    }
    // BUILDING
    if (!buildingId) {
      throw new BadRequestException(
        'buildingId es requerido para un fondo BUILDING',
      );
    }
    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);
  }

  private async assertNoActiveDuplicateName(
    tenantId: string,
    scopeType: CreateFundDto['scopeType'],
    buildingId: string | null,
    name: string,
    options: { excludeFundId?: string } = {},
  ): Promise<void> {
    const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');

    const candidates = await this.prisma.fund.findMany({
      where: {
        tenantId,
        scopeType,
        ...(buildingId ? { buildingId } : { buildingId: null }),
        status: FundStatus.ACTIVE,
      },
      select: { id: true, name: true },
    });

    const duplicate = candidates.find(
      (fund) =>
        fund.id !== options.excludeFundId &&
        fund.name.trim().toLowerCase().replace(/\s+/g, ' ') === normalized,
    );

    if (duplicate) {
      throw new ConflictException(
        'Ya existe un fondo activo con el mismo nombre en este alcance',
      );
    }
  }

  private async assertFundInTenant(tenantId: string, fundId: string): Promise<void> {
    const fund = await this.prisma.fund.findFirst({
      where: { id: fundId, tenantId },
      select: { id: true },
    });
    if (!fund) {
      throw new NotFoundException('Fondo no encontrado o no pertenece al tenant');
    }
  }

  /**
   * Computa balances por moneda desde el ledger (nunca persistido).
   * CREDIT suma, DEBIT resta. Monedas independientes.
   */
  private async computeBalances(
    tx: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    fundId: string,
  ): Promise<Array<{ currency: string; amountMinor: number }>> {
    const credits = await tx.fundTransaction.groupBy({
      by: ['currencyCode'],
      where: { tenantId, fundId, direction: FundTransactionDirection.CREDIT },
      _sum: { amountMinor: true },
    });
    const debits = await tx.fundTransaction.groupBy({
      by: ['currencyCode'],
      where: { tenantId, fundId, direction: FundTransactionDirection.DEBIT },
      _sum: { amountMinor: true },
    });

    const creditByCurrency = new Map(
      credits.map((row) => [row.currencyCode, row._sum.amountMinor ?? 0]),
    );
    const debitByCurrency = new Map(
      debits.map((row) => [row.currencyCode, row._sum.amountMinor ?? 0]),
    );

    const currencies = new Set([
      ...creditByCurrency.keys(),
      ...debitByCurrency.keys(),
    ]);

    return [...currencies]
      .sort()
      .map((currency) => ({
        currency,
        amountMinor:
          (creditByCurrency.get(currency) ?? 0) -
          (debitByCurrency.get(currency) ?? 0),
      }));
  }

  private async loadBalancesForFunds(
    tenantId: string,
    fundIds: string[],
  ): Promise<Map<string, Array<{ currency: string; amountMinor: number }>>> {
    if (fundIds.length === 0) {
      return new Map();
    }

    const credits = await this.prisma.fundTransaction.groupBy({
      by: ['fundId', 'currencyCode'],
      where: {
        tenantId,
        fundId: { in: fundIds },
        direction: FundTransactionDirection.CREDIT,
      },
      _sum: { amountMinor: true },
    });
    const debits = await this.prisma.fundTransaction.groupBy({
      by: ['fundId', 'currencyCode'],
      where: {
        tenantId,
        fundId: { in: fundIds },
        direction: FundTransactionDirection.DEBIT,
      },
      _sum: { amountMinor: true },
    });

    const creditByFund = new Map<string, Map<string, number>>();
    const debitByFund = new Map<string, Map<string, number>>();

    for (const row of credits) {
      const map = creditByFund.get(row.fundId) ?? new Map();
      map.set(row.currencyCode, row._sum.amountMinor ?? 0);
      creditByFund.set(row.fundId, map);
    }
    for (const row of debits) {
      const map = debitByFund.get(row.fundId) ?? new Map();
      map.set(row.currencyCode, row._sum.amountMinor ?? 0);
      debitByFund.set(row.fundId, map);
    }

    const result = new Map<string, Array<{ currency: string; amountMinor: number }>>();
    for (const fundId of fundIds) {
      const creditsMap = creditByFund.get(fundId) ?? new Map();
      const debitsMap = debitByFund.get(fundId) ?? new Map();
      const currencies = new Set([...creditsMap.keys(), ...debitsMap.keys()]);
      result.set(
        fundId,
        [...currencies].sort().map((currency) => ({
          currency,
          amountMinor:
            (creditsMap.get(currency) ?? 0) - (debitsMap.get(currency) ?? 0),
        })),
      );
    }
    return result;
  }

  private async assertSufficientBalance(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fundId: string,
    currencyCode: string,
    amountMinor: number,
  ): Promise<void> {
    // Semántica FIN-02 compartida (fund-ledger.ts): balance = SUM(CREDIT)-SUM(DEBIT)
    await assertSufficientFundBalance(tx, tenantId, fundId, currencyCode, amountMinor);
  }

  private async assertSameOperation(
    existing: { fundId: string; direction: FundTransactionDirection; amountMinor: number; currencyCode: string },
    fundId: string,
    dto: CreateFundTransactionDto,
  ): Promise<void> {
    const sameOperation =
      existing.fundId === fundId &&
      existing.direction === dto.direction &&
      existing.amountMinor === dto.amountMinor &&
      existing.currencyCode === dto.currencyCode;
    if (!sameOperation) {
      throw new ConflictException(
        'La idempotencyKey ya fue utilizada para una operación diferente',
      );
    }
  }

  private toFundDto(
    fund: Prisma.FundGetPayload<Record<string, never>>,
    balancesByCurrency: Array<{ currency: string; amountMinor: number }>,
  ): FundResponseDto {
    return {
      id: fund.id,
      tenantId: fund.tenantId,
      buildingId: fund.buildingId,
      scopeType: fund.scopeType,
      type: fund.type,
      name: fund.name,
      description: fund.description,
      status: fund.status,
      balancesByCurrency,
      createdAt: fund.createdAt,
      archivedAt: fund.archivedAt,
    };
  }

  private toTransactionDto(
    transaction: Prisma.FundTransactionGetPayload<Record<string, never>>,
  ): FundTransactionResponseDto {
    return {
      id: transaction.id,
      tenantId: transaction.tenantId,
      fundId: transaction.fundId,
      direction: transaction.direction,
      amountMinor: transaction.amountMinor,
      currencyCode: transaction.currencyCode,
      occurredAt: transaction.occurredAt,
      description: transaction.description,
      idempotencyKey: transaction.idempotencyKey,
      reversalOfTransactionId: transaction.reversalOfTransactionId,
      incomeApplicationId: transaction.incomeApplicationId,
      createdAt: transaction.createdAt,
    };
  }
}
