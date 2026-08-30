import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FundStatus, FundTransactionDirection, IncomeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { MovementAllocationService } from './movement-allocation.service';
import { CurrencyConversionService } from './currency-conversion.service';
import {
  CreateIncomeDto,
  UpdateIncomeDto,
  IncomeResponseDto,
} from './expense-ledger.dto';
import {
  acquireFundLock,
  acquireIncomeLock,
} from './fund-locks';
import { assertSufficientFundBalance } from './fund-ledger';

@Injectable()
export class IncomesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
    private readonly movementAllocationService: MovementAllocationService,
    private readonly currencyConversionService: CurrencyConversionService,
  ) {}

  async listIncomes(
    tenantId: string,
    userRoles: string[],
    filters?: {
      buildingId?: string;
      period?: string;
      categoryId?: string;
    },
  ): Promise<IncomeResponseDto[]> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden ver ingresos');
    }

    const incomes = await this.prisma.income.findMany({
      where: {
        tenantId,
        ...(filters?.buildingId && { buildingId: filters.buildingId }),
        ...(filters?.period && { period: filters.period }),
        ...(filters?.categoryId && { categoryId: filters.categoryId }),
      },
      include: { category: true },
      orderBy: { receivedDate: 'desc' },
    });

    return incomes.map((income) => this.toDto(income));
  }

  async getIncome(
    tenantId: string,
    incomeId: string,
    userRoles: string[],
  ): Promise<IncomeResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden ver ingresos');
    }

    const income = await this.prisma.income.findFirst({
      where: { id: incomeId, tenantId },
      include: { category: true },
    });

    if (!income) {
      throw new NotFoundException(`Ingreso no encontrado: ${incomeId}`);
    }

    return this.toDto(income);
  }

  async createIncome(
    tenantId: string,
    membershipId: string,
    userRoles: string[],
    dto: CreateIncomeDto,
  ): Promise<IncomeResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden crear ingresos');
    }

    const scopeType = dto.scopeType ?? 'BUILDING';
    const destination = dto.destination ?? 'APPLY_TO_EXPENSES';

    // Validate category exists and is INCOME type
    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: { id: dto.categoryId, tenantId },
    });

    if (!category) {
      throw new NotFoundException(`Rubro no encontrado: ${dto.categoryId}`);
    }

    if (category.movementType !== 'INCOME') {
      throw new BadRequestException(
        `El rubro "${category.name}" no es de tipo INGRESO`,
      );
    }

    // Validate scope-specific requirements
    if (scopeType === 'BUILDING') {
      if (!dto.buildingId) {
        throw new BadRequestException(
          'buildingId es requerido para scope BUILDING',
        );
      }
      await this.validators.validateBuildingBelongsToTenant(tenantId, dto.buildingId);
    } else if (scopeType === 'TENANT_SHARED') {
      if (!dto.allocations || dto.allocations.length === 0) {
        throw new BadRequestException(
          'allocations es requerido para scope TENANT_SHARED',
        );
      }
    } else if (scopeType === 'UNIT_GROUP') {
      if (!dto.unitGroupId) {
        throw new BadRequestException(
          'unitGroupId es requerido para scope UNIT_GROUP',
        );
      }
      if (!dto.allocations || dto.allocations.length === 0) {
        throw new BadRequestException(
          'allocations es requerido para scope UNIT_GROUP',
        );
      }
      // Validar que unitGroup exista y pertenezca al tenant
      const unitGroup = await this.prisma.unitGroup.findFirst({
        where: { id: dto.unitGroupId, tenantId },
      });
      if (!unitGroup) {
        throw new NotFoundException(`Grupo de unidades no encontrado: ${dto.unitGroupId}`);
      }
    }

    if ((scopeType === 'TENANT_SHARED' || scopeType === 'UNIT_GROUP') && dto.allocations) {
      await this.movementAllocationService.validateAllocations(
        tenantId,
        dto.allocations,
        dto.amountMinor,
        dto.currencyCode,
      );
    }

    const income = await this.prisma.$transaction(async (tx) => {
      const created = await tx.income.create({
        data: {
          tenantId,
          buildingId: dto.buildingId ?? null,
          period: dto.period,
          categoryId: dto.categoryId,
          amountMinor: dto.amountMinor,
          currencyCode: dto.currencyCode,
          receivedDate: new Date(dto.receivedDate),
          description: dto.description || null,
          attachmentFileKey: dto.attachmentFileKey || null,
          scopeType,
          destination,
          unitGroupId: dto.unitGroupId ?? null,
          status: 'DRAFT',
          createdByMembershipId: membershipId,
        },
        include: { category: true },
      });

      if ((scopeType === 'TENANT_SHARED' || scopeType === 'UNIT_GROUP') && dto.allocations) {
        await this.movementAllocationService.createForIncomeInTx(
          tx,
          tenantId,
          created.id,
          dto.amountMinor,
          dto.currencyCode,
          dto.allocations,
        );
      }

      return created;
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'INCOME_CREATE',
      entityType: 'Income',
      entityId: income.id,
      metadata: {
        period: income.period,
        categoryName: category.name,
        scopeType,
        destination,
        amountMinor: income.amountMinor,
        currencyCode: income.currencyCode,
      },
    });

    return this.toDto(income);
  }

  async updateIncome(
    tenantId: string,
    incomeId: string,
    membershipId: string,
    userRoles: string[],
    dto: UpdateIncomeDto,
  ): Promise<IncomeResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden editar ingresos');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await acquireIncomeLock(tx, tenantId, incomeId);
      const income = await tx.income.findFirst({
        where: { id: incomeId, tenantId },
        include: { category: true },
      });

      if (!income) {
        throw new NotFoundException(`Ingreso no encontrado: ${incomeId}`);
      }

      if (income.status !== 'DRAFT') {
        throw new BadRequestException(
          `Solo se pueden editar ingresos en DRAFT. Estado actual: ${income.status}`,
        );
      }

      const amountChanged = dto.amountMinor !== undefined && dto.amountMinor !== income.amountMinor;
      const currencyChanged = dto.currencyCode !== undefined && dto.currencyCode !== income.currencyCode;
      if (amountChanged || currencyChanged) {
        const allocationCount = await tx.movementAllocation.count({
          where: { tenantId, incomeId },
        });
        if (allocationCount > 0) {
          throw new ConflictException(
            'No se puede cambiar monto o moneda de un ingreso con allocations. Reemplace las allocations explícitamente antes de editarlo.',
          );
        }
      }

      // If changing category, validate it's INCOME type
      if (dto.categoryId && dto.categoryId !== income.categoryId) {
        const newCategory = await tx.expenseLedgerCategory.findFirst({
          where: { id: dto.categoryId, tenantId },
        });

        if (!newCategory) {
          throw new NotFoundException(`Rubro no encontrado: ${dto.categoryId}`);
        }

        if (newCategory.movementType !== 'INCOME') {
          throw new BadRequestException(
            `El rubro "${newCategory.name}" no es de tipo INGRESO`,
          );
        }
      }

      return tx.income.update({
        where: { id: incomeId },
        data: {
          amountMinor: dto.amountMinor ?? income.amountMinor,
          currencyCode: dto.currencyCode ?? income.currencyCode,
          receivedDate: dto.receivedDate
            ? new Date(dto.receivedDate)
            : income.receivedDate,
          categoryId: dto.categoryId ?? income.categoryId,
          description:
            dto.description !== undefined ? dto.description : income.description,
          attachmentFileKey:
            dto.attachmentFileKey !== undefined
              ? dto.attachmentFileKey
              : income.attachmentFileKey,
        },
        include: { category: true },
      });
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'INCOME_UPDATE',
      entityType: 'Income',
      entityId: incomeId,
      metadata: dto,
    });

    return this.toDto(updated);
  }

  private toConversionDate(receivedDate: Date): string {
    const year = receivedDate.getUTCFullYear();
    const month = String(receivedDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(receivedDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private async buildIncomeConversionSnapshot(
    tenantId: string,
    income: { amountMinor: number; currencyCode: string; receivedDate: Date },
  ): Promise<{
    functionalAmountMinor: number;
    functionalCurrencyCode: string;
    exchangeRateId: string | null;
    exchangeRateValue: string;
    exchangeRateDirection: 'IDENTITY' | 'DIRECT' | 'INVERSE';
    exchangeRateEffectiveAt: Date | null;
    conversionDate: Date;
  }> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { id: true, functionalCurrency: true },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant no encontrado: ${tenantId}`);
    }

    const result = await this.currencyConversionService.convert({
      tenantId,
      amount: income.amountMinor,
      originalCurrency: income.currencyCode as Parameters<
        typeof this.currencyConversionService.convert
      >[0]['originalCurrency'],
      functionalCurrency: tenant.functionalCurrency as Parameters<
        typeof this.currencyConversionService.convert
      >[0]['functionalCurrency'],
      conversionDate: this.toConversionDate(income.receivedDate),
    });

    return {
      functionalAmountMinor: result.functionalAmount,
      functionalCurrencyCode: result.functionalCurrency,
      exchangeRateId: result.sourceExchangeRateId,
      exchangeRateValue: result.appliedRate,
      exchangeRateDirection: result.direction,
      exchangeRateEffectiveAt: result.sourceEffectiveAt,
      conversionDate: result.conversionDate,
    };
  }

  async recordIncome(
    tenantId: string,
    incomeId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<IncomeResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden registrar ingresos');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await acquireIncomeLock(tx, tenantId, incomeId);
      const income = await tx.income.findFirst({
        where: { id: incomeId, tenantId },
        include: { category: true },
      });

      if (!income) {
        throw new NotFoundException(`Ingreso no encontrado: ${incomeId}`);
      }

      if (income.status !== 'DRAFT') {
        throw new BadRequestException(
          `No se puede registrar un ingreso en estado ${income.status}`,
        );
      }

      const conversionSnapshot = await this.buildIncomeConversionSnapshot(tenantId, income);
      return tx.income.update({
        where: { id: incomeId },
        data: {
          status: 'RECORDED',
          recordedByMembershipId: membershipId,
          recordedAt: new Date(),
          functionalAmountMinor: conversionSnapshot.functionalAmountMinor,
          functionalCurrencyCode: conversionSnapshot.functionalCurrencyCode,
          exchangeRateId: conversionSnapshot.exchangeRateId,
          exchangeRateValue: conversionSnapshot.exchangeRateValue,
          exchangeRateDirection: conversionSnapshot.exchangeRateDirection,
          exchangeRateEffectiveAt: conversionSnapshot.exchangeRateEffectiveAt,
          conversionDate: conversionSnapshot.conversionDate,
        },
        include: { category: true },
      });
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'INCOME_RECORD',
      entityType: 'Income',
      entityId: incomeId,
      metadata: { previousStatus: 'DRAFT', newStatus: updated.status },
    });

    return this.toDto(updated);
  }

  async voidIncome(
    tenantId: string,
    incomeId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<IncomeResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden anular ingresos');
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock del Income: serializa void contra creación de plan de aplicaciones.
      await acquireIncomeLock(tx, tenantId, incomeId);

      const income = await tx.income.findFirst({
        where: { id: incomeId, tenantId },
        include: { category: true },
      });
      if (!income) {
        throw new NotFoundException(`Ingreso no encontrado: ${incomeId}`);
      }

      // Idempotencia: un Income ya VOID se devuelve sin nuevas mutaciones.
      if (income.status === IncomeStatus.VOID) {
        return this.toDto(income as unknown as Parameters<typeof this.toDto>[0]);
      }

      // ── FIN-06: void-safety de IncomeApplications OFFSET usadas ──────────
      // Una IncomeApplication OFFSET referenciada por una liquidación
      // DRAFT/REVIEWED/PUBLISHED no puede desaparecer con el void del Income:
      // la historia ya se distribuyó o está comprometida en un draft.
      const offsetReferences = await tx.liquidationIncomeOffset.findMany({
        where: {
          tenantId,
          incomeApplication: { incomeId },
        },
        select: {
          liquidation: {
            select: { id: true, status: true, period: true },
          },
        },
      });

      const blockingReferences = offsetReferences.filter(
        (reference) => reference.liquidation !== null && reference.liquidation.status !== 'CANCELED',
      );

      if (blockingReferences.length > 0) {
        const statuses = [...new Set(blockingReferences.map((r) => r.liquidation!.status))];
        const message =
          statuses.includes('PUBLISHED')
            ? `No se puede anular el ingreso: una liquidación publicada ya distribuyó sus offsets (${blockingReferences.length}); la corrección requiere compensación/ajuste, no void destructivo`
            : `No se puede anular el ingreso: sus offsets están referenciados por ${blockingReferences.length} liquidación(es) activa(s) (${statuses.join(', ')}); cancelá la liquidación primero`;
        throw new ConflictException(message);
      }

      // Reversar automáticamente los FundTransactions CREDIT generados por
      // IncomeApplication FUND (ledger inmutable: reversa nueva, original intacto).
      const applications = await tx.incomeApplication.findMany({
        where: { tenantId, incomeId },
        include: { fundTransaction: true },
      });

      const fundIds = [...new Set(
        applications
          .map((app) => app.fundId)
          .filter((fundId): fundId is string => fundId !== null),
      )].sort();

      // Adquirir locks de Funds en orden determinístico ANTES de validar estado.
      for (const fundId of fundIds) {
        await acquireFundLock(tx, tenantId, fundId);
      }

      // FIN-03R (BLOCKER B): validar cada Fund CON el lock tomado.
      // ARCHIVED no acepta nuevos movimientos (FIN-02) → rechazar el void completo.
      if (fundIds.length > 0) {
        const funds = await tx.fund.findMany({
          where: { id: { in: fundIds }, tenantId },
          select: { id: true, status: true },
        });
        const fundById = new Map(funds.map((f) => [f.id, f]));
        for (const fundId of fundIds) {
          const fund = fundById.get(fundId);
          if (!fund) {
            throw new NotFoundException(`Fondo no encontrado o no pertenece al tenant: ${fundId}`);
          }
          if (fund.status !== FundStatus.ACTIVE) {
            throw new BadRequestException(
              `No se puede anular el ingreso: el fondo está archivado (${fundId})`,
            );
          }
        }
      }

      // Pre-validar saldo suficiente para TODOS los reversals DEBIT antes de
      // escribir cualquiera (all-or-nothing: sin reversals parciales).
      for (const app of applications) {
        const txRow = app.fundTransaction;
        if (!txRow || txRow.reversalOfTransactionId !== null) {
          continue; // sin CREDIT asociado o ya reversado (no duplicar)
        }
        const reversalDirection =
          txRow.direction === FundTransactionDirection.CREDIT
            ? FundTransactionDirection.DEBIT
            : FundTransactionDirection.CREDIT;
        if (reversalDirection === FundTransactionDirection.DEBIT) {
          await assertSufficientFundBalance(
            tx,
            tenantId,
            txRow.fundId,
            txRow.currencyCode,
            txRow.amountMinor,
          );
        }
      }

      let fundReversalCount = 0;
      for (const app of applications) {
        const txRow = app.fundTransaction;
        if (!txRow || txRow.reversalOfTransactionId !== null) {
          continue; // sin CREDIT asociado o ya reversado (no duplicar)
        }
        const reversalDirection =
          txRow.direction === FundTransactionDirection.CREDIT
            ? FundTransactionDirection.DEBIT
            : FundTransactionDirection.CREDIT;

        const reversal = await tx.fundTransaction.create({
          data: {
            tenantId,
            fundId: txRow.fundId,
            direction: reversalDirection,
            amountMinor: txRow.amountMinor,
            currencyCode: txRow.currencyCode,
            occurredAt: new Date(),
            description: `Void de ingreso ${incomeId} (aplicación ${app.id})`,
            createdByMembershipId: membershipId,
            reversalOfTransactionId: txRow.id,
          },
        });
        fundReversalCount += 1;

        await this.auditService.createLogRequired(
          {
            tenantId,
            actorMembershipId: membershipId,
            action: 'FUND_TRANSACTION_REVERSE',
            entityType: 'FundTransaction',
            entityId: reversal.id,
            metadata: {
              fundId: txRow.fundId,
              originalTransactionId: txRow.id,
              direction: reversalDirection,
              amountMinor: txRow.amountMinor,
              currencyCode: txRow.currencyCode,
            },
          },
          tx,
        );
      }

      const updated = await tx.income.update({
        where: { id: incomeId },
        data: {
          status: 'VOID',
          voidedByMembershipId: membershipId,
          voidedAt: new Date(),
        },
        include: { category: true },
      });

      // INCOME_VOID required en la misma transacción cuando hay efectos financieros.
      await this.auditService.createLogRequired(
        {
          tenantId,
          actorMembershipId: membershipId,
          action: 'INCOME_VOID',
          entityType: 'Income',
          entityId: incomeId,
          metadata: {
            previousStatus: income.status,
            newStatus: 'VOID',
            applicationCount: applications.length,
            ...(fundReversalCount > 0 ? { fundReversalCount } : {}),
          },
        },
        tx,
      );

      return this.toDto(updated);
    });
  }

  private toDto(income: {
    id: string;
    tenantId: string;
    buildingId: string | null;
    period: string;
    categoryId: string;
    amountMinor: number;
    currencyCode: string;
    receivedDate: Date;
    description: string | null;
    attachmentFileKey: string | null;
    status: 'DRAFT' | 'RECORDED' | 'VOID';
    scopeType: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';
    destination: 'APPLY_TO_EXPENSES' | 'RESERVE_FUND' | 'SPECIAL_FUND';
    unitGroupId: string | null;
    functionalAmountMinor?: number | null;
    functionalCurrencyCode?: string | null;
    exchangeRateId?: string | null;
    exchangeRateValue?: { toString(): string } | string | null;
    exchangeRateDirection?: string | null;
    exchangeRateEffectiveAt?: Date | null;
    conversionDate?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    category: { name: string };
  }): IncomeResponseDto {
    return {
      id: income.id,
      tenantId: income.tenantId,
      buildingId: income.buildingId,
      period: income.period,
      categoryId: income.categoryId,
      categoryName: income.category.name,
      amountMinor: income.amountMinor,
      currencyCode: income.currencyCode,
      receivedDate: income.receivedDate,
      description: income.description,
      attachmentFileKey: income.attachmentFileKey,
      status: income.status,
      scopeType: income.scopeType,
      destination: income.destination,
      unitGroupId: income.unitGroupId,
      functionalAmountMinor: income.functionalAmountMinor ?? null,
      functionalCurrencyCode: income.functionalCurrencyCode ?? null,
      exchangeRateId: income.exchangeRateId ?? null,
      exchangeRateValue:
        income.exchangeRateValue === null || income.exchangeRateValue === undefined
          ? null
          : income.exchangeRateValue.toString(),
      exchangeRateDirection: income.exchangeRateDirection ?? null,
      exchangeRateEffectiveAt: income.exchangeRateEffectiveAt ?? null,
      conversionDate: income.conversionDate ?? null,
      createdAt: income.createdAt,
      updatedAt: income.updatedAt,
    };
  }
}
