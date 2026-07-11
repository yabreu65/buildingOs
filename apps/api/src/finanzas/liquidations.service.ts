import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ChargeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateLiquidationDraftDto,
  PublishLiquidationDto,
  LiquidationResponseDto,
  LiquidationDetailDto,
} from './expense-ledger.dto';
import { FinanzasValidators } from './finanzas.validators';

interface LiquidationExpenseSnapshotItem extends Prisma.InputJsonObject {
  expenseId: string;
  categoryName: string;
  vendorName: string | null;
  amountMinor: number;
  currencyCode: string;
  invoiceDate: string;
  description: string | null;
  type: 'EXPENSE' | 'ADJUSTMENT';
  sourcePeriod?: string;
}

interface LiquidationExpenseSnapshotRow {
  expenseId: string;
  categoryName: string;
  vendorName: string | null;
  amountMinor: number;
  currencyCode: string;
  invoiceDate: Date;
  description: string | null;
  type: 'EXPENSE' | 'ADJUSTMENT';
  sourcePeriod?: string;
}

interface CancelLiquidationOptions {
  readonly buildingId?: string;
  readonly reason?: string;
}

interface NotificationDispatchResult {
  readonly sentCount: number;
  readonly failedCount: number;
  readonly errorMessages: ReadonlyArray<string>;
}

@Injectable()
export class LiquidationsService {
  private readonly logger = new Logger(LiquidationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
    private readonly notificationsService: NotificationsService,
  ) {}

  private expenseAccountingPeriodWhere(period: string): {
    OR: Array<{ liquidationPeriod: string } | { liquidationPeriod: null; period: string }>;
  } {
    return {
      OR: [
        { liquidationPeriod: period },
        { liquidationPeriod: null, period },
      ],
    };
  }

  async listLiquidations(
    tenantId: string,
    userRoles: string[],
    query: { buildingId?: string; period?: string },
  ): Promise<LiquidationResponseDto[]> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden ver liquidaciones');
    }

    const liquidations = await this.prisma.liquidation.findMany({
      where: {
        tenantId,
        buildingId: query.buildingId,
        period: query.period,
        status: { not: 'CANCELED' },
      },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
    });

    return liquidations.map(this.toDto);
  }

  async getLiquidation(
    tenantId: string,
    liquidationId: string,
    userRoles: string[],
  ): Promise<LiquidationDetailDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Acceso denegado');
    }

    const liq = await this.prisma.liquidation.findFirst({
      where: { id: liquidationId, tenantId },
      include: {
        charges: {
          where: { canceledAt: null },
          include: { unit: { select: { id: true, code: true, label: true } } },
          orderBy: { unit: { code: 'asc' } },
        },
      },
    });

    if (!liq) {
      throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
    }

    // Rebuild expense list from snapshot
    const expenseSnapshot = this.parseExpenseSnapshot(liq.expenseSnapshot);

    return {
      ...this.toDto(liq),
      expenses: expenseSnapshot.map((e) => ({
        id: e.expenseId,
        categoryName: e.categoryName,
        vendorName: e.vendorName,
        amountMinor: e.amountMinor,
        currencyCode: e.currencyCode,
        invoiceDate: new Date(e.invoiceDate),
        description: e.description,
      })),
      chargesPreview: liq.charges.map((c) => ({
        unitId: c.unit.id,
        unitCode: c.unit.code,
        unitLabel: c.unit.label,
        amountMinor: c.amount,
      })),
    };
  }

  async createDraft(
    tenantId: string,
    membershipId: string,
    userRoles: string[],
    dto: CreateLiquidationDraftDto,
  ): Promise<LiquidationDetailDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden generar liquidaciones');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, dto.buildingId);

    // Anti-duplicado: no puede haber otra PUBLISHED para este (building, period)
    const existingPublished = await this.prisma.liquidation.findFirst({
      where: {
        tenantId,
        buildingId: dto.buildingId,
        period: dto.period,
        status: 'PUBLISHED',
      },
    });

    if (existingPublished) {
      throw new ConflictException(
        `Ya existe una liquidación publicada para el período ${dto.period} en este edificio`,
      );
    }

    // Prerequisito: no puede haber gastos de áreas comunes (TENANT_SHARED) sin validar para este período.
    // Si los hay, el admin debe validarlos primero antes de liquidar cualquier edificio,
    // para garantizar que el reparto esté completo y correcto.
    const pendingSharedExpenses = await this.prisma.expense.count({
      where: {
        tenantId,
        ...this.expenseAccountingPeriodWhere(dto.period),
        scopeType: 'TENANT_SHARED',
        status: 'DRAFT',
      },
    });

    if (pendingSharedExpenses > 0) {
      throw new BadRequestException(
        `Hay ${pendingSharedExpenses} gasto(s) de áreas comunes pendientes de validar para ${dto.period}. ` +
        `Validalos desde Finanzas → Gastos comunes antes de generar la liquidación del edificio.`,
      );
    }

    // Cargar gastos VALIDATED del (building, period) - solo BUILDING scope
    const buildingExpenses = await this.prisma.expense.findMany({
      where: {
        tenantId,
        buildingId: dto.buildingId,
        ...this.expenseAccountingPeriodWhere(dto.period),
        status: 'VALIDATED',
        scopeType: 'BUILDING',
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    // Cargar gastos VALIDATED TENANT_SHARED que tienen allocation a este edificio
    const sharedExpenses = await this.prisma.expense.findMany({
      where: {
        tenantId,
        ...this.expenseAccountingPeriodWhere(dto.period),
        status: 'VALIDATED',
        scopeType: 'TENANT_SHARED',
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
        allocations: {
          where: { buildingId: dto.buildingId },
        },
      },
    });

    // Filtrar solo los que tienen allocation a este edificio
    const allocatedSharedExpenses = sharedExpenses.filter(e => e.allocations.length > 0);

    // Combinar: buildingExpenses (monto completo) + allocatedSharedExpenses (solo monto asignado)
    const allExpenses: LiquidationExpenseSnapshotRow[] = buildingExpenses.map((expense) => ({
      expenseId: expense.id,
      categoryName: expense.category.name,
      vendorName: expense.vendor?.name ?? null,
      amountMinor: expense.amountMinor,
      currencyCode: expense.currencyCode,
      invoiceDate: expense.invoiceDate,
      description: expense.description,
      type: 'EXPENSE',
    }));
    for (const exp of allocatedSharedExpenses) {
      const allocation = exp.allocations[0];
      if (allocation && allocation.amountMinor !== null) {
        allExpenses.push({
          expenseId: exp.id,
          categoryName: exp.category.name,
          vendorName: exp.vendor?.name ?? null,
          amountMinor: allocation.amountMinor,
          currencyCode: exp.currencyCode,
          invoiceDate: exp.invoiceDate,
          description: exp.description,
          type: 'EXPENSE',
        });
      }
    }

    // Calcular totales por moneda - inicializar antes de usar
    const totalsByCurrency: Record<string, number> = {};
    for (const expense of allExpenses) {
      const expCurrency = expense.currencyCode;
      const expAmount = expense.amountMinor;
      totalsByCurrency[expCurrency] =
        (totalsByCurrency[expCurrency] ?? 0) + expAmount;
    }

    // NUEVO: Cargar ajustes VALIDATED para este edificio y período target
    const adjustments = await this.prisma.adjustment.findMany({
      where: {
        tenantId,
        buildingId: dto.buildingId,
        targetPeriod: dto.period,
        status: 'VALIDATED',
      },
      include: {
        category: { select: { name: true } },
      },
    });

    // Si hay ajustes, agregarlos al snapshot y a los totales
    const expenseSnapshotItems: LiquidationExpenseSnapshotItem[] = allExpenses.map((e) => ({
      expenseId: e.expenseId,
      categoryName: e.categoryName,
      vendorName: e.vendorName,
      amountMinor: e.amountMinor,
      currencyCode: e.currencyCode,
      invoiceDate: e.invoiceDate.toISOString(),
      description: e.description,
      type: e.type,
    }));

    for (const adj of adjustments) {
      expenseSnapshotItems.push({
        expenseId: `ADJ-${adj.id}`,
        categoryName: adj.category.name,
        vendorName: null,
        amountMinor: adj.amountMinor,
        currencyCode: adj.currencyCode,
        invoiceDate: adj.sourceInvoiceDate.toISOString(),
        description: `Ajuste retroactivo: ${adj.reason}`,
        type: 'ADJUSTMENT',
        sourcePeriod: adj.sourcePeriod,
      });
      const adjCurrency = adj.currencyCode;
      totalsByCurrency[adjCurrency] = (totalsByCurrency[adjCurrency] ?? 0) + adj.amountMinor;
    }

    const expenseSnapshot: ReadonlyArray<LiquidationExpenseSnapshotItem> = expenseSnapshotItems;

    if (allExpenses.length === 0 && adjustments.length === 0) {
      throw new BadRequestException(
        `No hay gastos VALIDADOS ni ajustes para el período ${dto.period} en este edificio. ` +
        `Registrá gastos propios del edificio o verificá que los gastos comunes tengan asignación a este edificio.`,
      );
    }

    // Total en baseCurrency
    const totalAmountMinor = totalsByCurrency[dto.baseCurrency] ?? 0;

    // Contar unidades billables
    const billableUnits = await this.prisma.unit.findMany({
      where: { tenantId, buildingId: dto.buildingId, isBillable: true },
      include: { unitCategory: { select: { coefficient: true, id: true } } },
      orderBy: { code: 'asc' },
    });

    // Snapshot ya calculado arriba con tipo EXPENSE/ADJUSTMENT

    const liq = await this.prisma.liquidation.create({
      data: {
        tenantId,
        buildingId: dto.buildingId,
        period: dto.period,
        baseCurrency: dto.baseCurrency,
        totalAmountMinor,
        totalsByCurrency,
        expenseSnapshot,
        unitCount: billableUnits.length,
        generatedByMembershipId: membershipId,
      },
    });

    await this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'LIQUIDATION_DRAFT',
      entityType: 'Liquidation',
      entityId: liq.id,
      metadata: {
        period: dto.period,
        buildingId: dto.buildingId,
        totalAmountMinor,
        baseCurrency: dto.baseCurrency,
        expenseCount: allExpenses.length,
        adjustmentCount: adjustments.length,
      },
    });

    // Calcular preview de distribución para el detail
    const chargesPreview = this.calculateDistribution(
      billableUnits,
      totalAmountMinor,
      dto.buildingId,
    );

    return {
      ...this.toDto(liq),
      expenses: expenseSnapshot.map((e) => ({
        id: e.expenseId,
        categoryName: e.categoryName,
        vendorName: e.vendorName,
        amountMinor: e.amountMinor,
        currencyCode: e.currencyCode,
        invoiceDate: new Date(e.invoiceDate),
        description: e.description,
      })),
      chargesPreview,
    };
  }

  async reviewLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<LiquidationResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Acceso denegado');
    }

    const liq = await this.prisma.liquidation.findFirst({
      where: { id: liquidationId, tenantId },
    });

    if (!liq) {
      throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
    }

    if (liq.status !== 'DRAFT') {
      throw new BadRequestException(
        `Solo se puede revisar una liquidación en DRAFT. Estado actual: ${liq.status}`,
      );
    }

    await this.prisma.liquidation.updateMany({
      where: { id: liquidationId, tenantId },
      data: {
        status: 'REVIEWED',
        reviewedByMembershipId: membershipId,
        reviewedAt: new Date(),
      },
    });

    const updated = await this.prisma.liquidation.findFirst({
      where: { id: liquidationId, tenantId },
    });

    if (!updated) {
      throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
    }

    await this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'LIQUIDATION_REVIEW',
      entityType: 'Liquidation',
      entityId: liquidationId,
      metadata: { period: liq.period, buildingId: liq.buildingId },
    });

    return this.toDto(updated);
  }

  async publishLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
    userRoles: string[],
    dto: PublishLiquidationDto,
  ): Promise<LiquidationResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Acceso denegado');
    }

    const liq = await this.prisma.liquidation.findFirst({
      where: { id: liquidationId, tenantId },
    });

    if (!liq) {
      throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
    }

    if (liq.status === 'PUBLISHED') {
      return this.toDto(liq);
    }

    if (liq.status !== 'DRAFT' && liq.status !== 'REVIEWED') {
      throw new BadRequestException(
        `Solo se puede publicar una liquidación en DRAFT o REVIEWED. Estado actual: ${liq.status}`,
      );
    }

    // Cargar unidades billables con categorías para distribución
    const billableUnits = await this.prisma.unit.findMany({
      where: { tenantId, buildingId: liq.buildingId, isBillable: true },
      include: { unitCategory: { select: { coefficient: true, id: true } } },
      orderBy: { code: 'asc' },
    });

    if (billableUnits.length === 0) {
      throw new BadRequestException('No hay unidades facturables en este edificio');
    }

    const dueDate = new Date(dto.dueDate);
    const concept = `Expensas comunes ${liq.period}`;
    const distribution = this.calculateDistribution(
      billableUnits,
      liq.totalAmountMinor,
      liq.buildingId,
    );

    let shouldSendPublishedNotifications = false;
    let publishResult: { publishedNow: boolean; liquidation?: LiquidationResponseDto } | null = null;

    try {
      publishResult = await this.prisma.$transaction(
        async (tx) => {
        const current = await tx.liquidation.findFirst({
          where: { id: liquidationId, tenantId },
          select: { status: true },
        });

        if (!current) {
          throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
        }

        if (current.status === 'PUBLISHED') {
          const published = await tx.liquidation.findFirst({
            where: { id: liquidationId, tenantId },
          });

          if (!published) {
            throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
          }

          return { publishedNow: false, liquidation: this.toDto(published) };
        }

        if (current.status !== 'DRAFT' && current.status !== 'REVIEWED') {
          throw new BadRequestException(
            `Solo se puede publicar una liquidación en DRAFT o REVIEWED. Estado actual: ${current.status}`,
          );
        }

        const duplicatePublished = await tx.liquidation.findFirst({
          where: {
            tenantId,
            buildingId: liq.buildingId,
            period: liq.period,
            status: 'PUBLISHED',
            id: { not: liquidationId },
          },
          select: { id: true },
        });

        if (duplicatePublished) {
          throw new ConflictException(
            `Ya existe una liquidación publicada para el período ${liq.period}`,
          );
        }

        const duplicateCharges = await tx.charge.count({
          where: {
            tenantId,
            liquidationId,
            period: liq.period,
            unitId: { in: distribution.map((d) => d.unitId) },
          },
        });

        if (duplicateCharges === distribution.length) {
          await tx.liquidation.updateMany({
            where: { id: liquidationId, tenantId },
            data: {
              status: 'PUBLISHED',
              publishedByMembershipId: membershipId,
              publishedAt: new Date(),
            },
          });

          const liquidation = await tx.liquidation.findFirst({
            where: { id: liquidationId, tenantId },
          });

          if (!liquidation) {
            throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
          }

          return { publishedNow: true, liquidation: this.toDto(liquidation) };
        }

        if (duplicateCharges > 0) {
          throw new ConflictException(
            `La liquidación ${liquidationId} tiene cargos parciales generados para ${liq.period}`,
          );
        }

        const chargeData = distribution.map((d) => ({
          tenantId,
          buildingId: liq.buildingId,
          unitId: d.unitId,
          period: liq.period,
          type: 'COMMON_EXPENSE' as const,
          concept,
          amount: d.amountMinor,
          currency: liq.baseCurrency,
          dueDate,
          status: ChargeStatus.PENDING,
          liquidationId,
          createdByMembershipId: membershipId,
        }));

        await tx.charge.createMany({ data: chargeData });

        await tx.liquidation.updateMany({
          where: { id: liquidationId, tenantId },
          data: {
            status: 'PUBLISHED',
            publishedByMembershipId: membershipId,
            publishedAt: new Date(),
          },
        });

        const liquidation = await tx.liquidation.findFirst({
          where: { id: liquidationId, tenantId },
        });

        if (!liquidation) {
          throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
        }

        return { publishedNow: true, liquidation: this.toDto(liquidation) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (!publishResult) {
        throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
      }

      shouldSendPublishedNotifications = publishResult.publishedNow;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const current = await this.prisma.liquidation.findFirst({
          where: { id: liquidationId, tenantId },
        });

        if (current?.status === 'PUBLISHED') {
          return this.toDto(current);
        }

        throw new ConflictException(
          `La liquidación ${liquidationId} ya tiene cargos generados para ${liq.period}`,
        );
      }

      throw error;
    }

    if (shouldSendPublishedNotifications) {
      await this.auditService.createLog({
        tenantId,
        actorMembershipId: membershipId,
        action: 'LIQUIDATION_PUBLISH',
        entityType: 'Liquidation',
        entityId: liquidationId,
        metadata: {
          period: liq.period,
          buildingId: liq.buildingId,
          chargesCount: distribution.length,
          totalAmountMinor: liq.totalAmountMinor,
          baseCurrency: liq.baseCurrency,
        },
      });

      // [PHASE 2 QUICK #2] Send CHARGE_PUBLISHED notifications to all residents
      const notificationResult = await this.sendChargePublishedNotifications(tenantId, liquidationId, {
        period: liq.period,
        buildingId: liq.buildingId,
        baseCurrency: liq.baseCurrency,
      });

      if (notificationResult.failedCount > 0) {
        await this.auditService.createLog({
          tenantId,
          actorMembershipId: membershipId,
          action: 'LIQUIDATION_PUBLISH',
          entityType: 'Liquidation',
          entityId: liquidationId,
          metadata: {
            period: liq.period,
            buildingId: liq.buildingId,
            notificationFailure: true,
            sentCount: notificationResult.sentCount,
            failedCount: notificationResult.failedCount,
            errorMessages: notificationResult.errorMessages,
          },
        });
        this.logger.warn(
          `Charge notifications for liquidation ${liquidationId} completed with ${notificationResult.failedCount} failure(s)`,
        );
        throw new ConflictException(
          `Charge notifications completed with ${notificationResult.failedCount} failure(s)`,
        );
      }
    }

    if (!publishResult?.liquidation) {
      throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
    }

    return this.toDto(publishResult.liquidation);
  }

  async cancelLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
    userRoles: string[],
    options: CancelLiquidationOptions = {},
  ): Promise<LiquidationResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Acceso denegado');
    }

    const liq = await this.prisma.liquidation.findFirst({
      where: { id: liquidationId, tenantId },
    });

    if (!liq) {
      throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
    }

    if (liq.canceledAt) {
      return this.toDto(liq);
    }

    const cancellation = await this.prisma.$transaction(async (tx) => {
      const current = await tx.liquidation.findFirst({
        where: { id: liquidationId, tenantId },
      });

      if (!current) {
        throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
      }

      if (current.canceledAt) {
        return { liquidation: current, canceled: false };
      }

      if (options.buildingId && current.buildingId !== options.buildingId) {
        throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
      }

      const canceledAt = new Date();
      const cancellationReason = options.reason?.trim() || 'No reason provided';

      if (current.status === 'PUBLISHED') {
        throw new ConflictException(
          'No se puede cancelar una liquidación publicada; use un flujo de reversa o compensación',
        );
      }

      const cancelResult = await tx.liquidation.updateMany({
        where: { id: liquidationId, tenantId, canceledAt: null, status: { not: 'CANCELED' } },
        data: {
          status: 'CANCELED',
          canceledAt,
          canceledByMembershipId: membershipId,
        },
      });

      const liquidation = await tx.liquidation.findFirst({
        where: { id: liquidationId, tenantId },
      });

      if (!liquidation) {
        throw new NotFoundException(`Liquidación no encontrada: ${liquidationId}`);
      }

      if (cancelResult.count === 0 && liquidation.status !== 'CANCELED') {
        throw new ConflictException(
          `No se pudo cancelar la liquidación ${liquidationId} porque cambió durante la operación`,
        );
      }

      if (cancelResult.count > 0) {
        await tx.auditLog.create({
          data: {
            tenantId,
            actorMembershipId: membershipId,
            action: 'LIQUIDATION_CANCEL',
            entity: 'Liquidation',
            entityId: liquidationId,
            metadata: {
              period: current.period,
              buildingId: current.buildingId,
              previousStatus: current.status,
              canceledAt: canceledAt.toISOString(),
              reason: cancellationReason,
            },
          },
        });
      }

      return { liquidation, canceled: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.toDto(cancellation.liquidation);
  }

  /**
   * Distribuye totalAmountMinor entre unidades:
   * - Si tienen unitCategory con coefficient → algoritmo Largest Remainder
   * - Si no → distribución igualitaria
   */
  private calculateDistribution(
    billableUnits: Array<{
      id: string;
      code: string;
      label: string | null;
      unitCategory: { coefficient: number; id: string } | null;
    }>,
    totalAmountMinor: number,
    _buildingId: string,
  ): Array<{ unitId: string; unitCode: string; unitLabel: string | null; amountMinor: number }> {
    if (billableUnits.length === 0) return [];
    if (totalAmountMinor < 0) {
      throw new BadRequestException('Liquidation total amount cannot be negative');
    }

    const billableUnitsWithCoefficients = billableUnits.filter(
      (
        unit,
      ): unit is {
        id: string;
        code: string;
        label: string | null;
        unitCategory: { coefficient: number; id: string };
      } => unit.unitCategory !== null,
    );
    const hasCoefficients = billableUnitsWithCoefficients.length === billableUnits.length;

    if (billableUnitsWithCoefficients.some((unit) => unit.unitCategory.coefficient < 0)) {
      throw new BadRequestException('Unit coefficients cannot be negative');
    }

    if (hasCoefficients) {
      const sumCoef = billableUnitsWithCoefficients.reduce((sum, u) => sum + u.unitCategory.coefficient, 0);

      if (sumCoef === 0) {
        return this.equalDistribution(billableUnits, totalAmountMinor);
      }

      // Largest Remainder
      const amounts = billableUnitsWithCoefficients.map((unit) => {
        const coef = unit.unitCategory.coefficient;
        const exact = (coef / sumCoef) * totalAmountMinor;
        const floor = Math.floor(exact);
        return { unit, floor, fraction: exact - floor };
      });

      let allocated = amounts.reduce((s, a) => s + a.floor, 0);
      const delta = totalAmountMinor - allocated;

      amounts
        .slice()
        .sort((a, b) => b.fraction - a.fraction)
        .slice(0, delta)
        .forEach((a) => {
          const found = amounts.find((x) => x.unit.id === a.unit.id);
          if (found) found.floor += 1;
        });

      return amounts.map((a) => ({
        unitId: a.unit.id,
        unitCode: a.unit.code,
        unitLabel: a.unit.label,
        amountMinor: a.floor,
      }));
    }

    return this.equalDistribution(billableUnits, totalAmountMinor);
  }

  private equalDistribution(
    billableUnits: Array<{ id: string; code: string; label: string | null }>,
    totalAmountMinor: number,
  ): Array<{ unitId: string; unitCode: string; unitLabel: string | null; amountMinor: number }> {
    const count = billableUnits.length;
    const base = Math.floor(totalAmountMinor / count);
    const remainder = totalAmountMinor - base * count;

    return billableUnits.map((u, i) => ({
      unitId: u.id,
      unitCode: u.code,
      unitLabel: u.label,
      amountMinor: base + (i < remainder ? 1 : 0),
    }));
  }

  private toDto(liq: {
    id: string;
    tenantId: string;
    buildingId: string;
    period: string;
    status: 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'CANCELED';
    baseCurrency: string;
    totalAmountMinor: number;
    totalsByCurrency: unknown;
    unitCount: number;
    generatedAt: Date;
    reviewedAt: Date | null;
    publishedAt: Date | null;
    canceledAt: Date | null;
    createdAt: Date;
  }): LiquidationResponseDto {
    const totalsByCurrency = this.parseTotalsByCurrency(liq.totalsByCurrency);

    return {
      id: liq.id,
      tenantId: liq.tenantId,
      buildingId: liq.buildingId,
      period: liq.period,
      status: liq.status,
      baseCurrency: liq.baseCurrency,
      totalAmountMinor: liq.totalAmountMinor,
      totalsByCurrency,
      unitCount: liq.unitCount,
      generatedAt: liq.generatedAt,
      reviewedAt: liq.reviewedAt,
      publishedAt: liq.publishedAt,
      canceledAt: liq.canceledAt,
      createdAt: liq.createdAt,
    };
  }

  private parseTotalsByCurrency(value: unknown): Record<string, number> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Liquidation totalsByCurrency snapshot is invalid');
    }

    const result: Record<string, number> = {};

    for (const [currency, amount] of Object.entries(value as Record<string, unknown>)) {
      if (typeof amount !== 'number' || !Number.isFinite(amount)) {
        throw new BadRequestException(
          `Liquidation totalsByCurrency snapshot has invalid amount for ${currency}`,
        );
      }

      result[currency] = amount;
    }

    return result;
  }

  private parseExpenseSnapshot(value: unknown): LiquidationExpenseSnapshotItem[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException('Liquidation expense snapshot is invalid');
    }

    return value.map((item, index) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw new BadRequestException(`Liquidation expense snapshot item ${index} is invalid`);
      }

      const snapshot = item as Record<string, unknown>;
      const expenseId = snapshot.expenseId;
      const categoryName = snapshot.categoryName;
      const vendorName = snapshot.vendorName;
      const amountMinor = snapshot.amountMinor;
      const currencyCode = snapshot.currencyCode;
      const invoiceDate = snapshot.invoiceDate;
      const description = snapshot.description;
      const type = snapshot.type;
      const sourcePeriod = snapshot.sourcePeriod;

      if (typeof expenseId !== 'string') {
        throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid expenseId`);
      }
      if (typeof categoryName !== 'string') {
        throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid categoryName`);
      }
      if (vendorName !== null && typeof vendorName !== 'string') {
        throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid vendorName`);
      }
      if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor)) {
        throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid amountMinor`);
      }
      if (typeof currencyCode !== 'string') {
        throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid currencyCode`);
      }
      if (typeof invoiceDate !== 'string') {
        throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid invoiceDate`);
      }
      if (description !== null && typeof description !== 'string') {
        throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid description`);
      }
      if (type !== 'EXPENSE' && type !== 'ADJUSTMENT') {
        throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid type`);
      }
      if (sourcePeriod !== undefined && sourcePeriod !== null && typeof sourcePeriod !== 'string') {
        throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid sourcePeriod`);
      }

      return {
        expenseId,
        categoryName,
        vendorName,
        amountMinor,
        currencyCode,
        invoiceDate,
        description,
        type,
        sourcePeriod: sourcePeriod ?? undefined,
      };
    });
  }

  /**
   * [PHASE 2 QUICK #2] Send CHARGE_PUBLISHED notifications to residents
   * Best-effort notification dispatch with observable result.
   */
  private async sendChargePublishedNotifications(
    tenantId: string,
    liquidationId: string,
    liquidation: {
      period: string;
      buildingId: string;
      baseCurrency: string;
    },
  ): Promise<NotificationDispatchResult> {
    let sentCount = 0;
    let failedCount = 0;
    const errorMessages: string[] = [];

    try {
      // Load all charges for this liquidation
      const charges = await this.prisma.charge.findMany({
        where: { tenantId, liquidationId },
      });

      // For each charge, load unit and occupants
      for (const charge of charges) {
        const unit = await this.prisma.unit.findFirst({
          where: {
            tenantId,
            buildingId: liquidation.buildingId,
            id: charge.unitId,
          },
          include: {
            unitOccupants: {
              where: { endDate: null }, // Active occupants only
              include: {
                member: { select: { id: true, user: { select: { id: true } } } },
              },
            },
          },
        });

        if (!unit) continue;

        // Send notification to each active resident
        for (const occupant of unit.unitOccupants) {
          if (occupant.member?.user?.id) {
            const dueDateStr = charge.dueDate
              ? new Date(charge.dueDate).toLocaleDateString('es-AR')
              : 'N/A';

            try {
              await this.notificationsService.createNotification({
                tenantId,
                userId: occupant.member.user.id,
                type: 'CHARGE_PUBLISHED',
                title: `${liquidation.buildingId} - Nuevo cargo por ${liquidation.period}`,
                body: `Se ha registrado un cargo de ${(charge.amount / 100).toFixed(2)} ${liquidation.baseCurrency} en la unidad ${unit.label}. Vencimiento: ${dueDateStr}`,
                data: {
                  chargeId: charge.id,
                  unitLabel: unit.label,
                  unitId: unit.id,
                  amount: charge.amount / 100,
                  currency: charge.currency,
                  dueDate: charge.dueDate?.toISOString(),
                  period: liquidation.period,
                },
                deliveryMethods: ['IN_APP', 'EMAIL'],
              });
              sentCount += 1;
            } catch (notificationError) {
              failedCount += 1;
              errorMessages.push(
                notificationError instanceof Error
                  ? notificationError.message
                  : String(notificationError),
              );
              this.logger.error(
                `Failed to create notification for charge ${charge.id} in liquidation ${liquidationId}`,
                notificationError instanceof Error ? notificationError.stack : String(notificationError),
              );
            }
          } else {
            failedCount += 1;
            errorMessages.push(
              `Missing user for occupant ${occupant.member?.id ?? 'unknown'} in unit ${unit.id}`,
            );
          }
        }
      }
    } catch (error) {
      failedCount += 1;
      errorMessages.push(error instanceof Error ? error.message : String(error));
      try {
        await this.auditService.createLog({
          tenantId,
          action: 'LIQUIDATION_PUBLISH',
          entityType: 'Liquidation',
          entityId: liquidationId,
          metadata: {
            period: liquidation.period,
            buildingId: liquidation.buildingId,
            notificationFailure: true,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      } catch (auditError) {
        this.logger.error(
          `Failed to persist notification failure audit for liquidation ${liquidationId}`,
          auditError instanceof Error ? auditError.stack : String(auditError),
        );
      }

      // Fire-and-forget: log but never fail
      this.logger.error(
        `Failed to send charge notifications for liquidation ${liquidationId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return { sentCount, failedCount, errorMessages };
  }
}
