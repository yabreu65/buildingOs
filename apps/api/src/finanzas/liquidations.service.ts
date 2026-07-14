import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ChargeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateLiquidationDraftDto,
  PublishLiquidationDto,
  LiquidationResponseDto,
  LiquidationDetailDto,
} from './expense-ledger.dto';
import { FinanzasValidators } from './finanzas.validators';
import {
  parseLiquidationPublicationSnapshot,
  type PublishedExpenseSnapshot,
} from './liquidation-publication-snapshot';
import {
  createLiquidationDraftRecord,
  LiquidationPublicationUseCase,
  parseTotalsByCurrency,
  requireFinanceMembership,
  reviewLiquidationRecord,
} from './liquidation-publication.use-case';

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

@Injectable()
export class LiquidationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
    private readonly publicationUseCase: LiquidationPublicationUseCase,
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
    membershipId: string,
    query: { buildingId?: string; period?: string },
  ): Promise<LiquidationResponseDto[]> {
    const membership = await requireFinanceMembership(
      this.prisma,
      tenantId,
      membershipId,
      (roles) => this.validators.isAdminOrOperator(roles),
    );
    if (!this.validators.isAdminOrOperator(membership.roles)) {
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

    return liquidations.map((liquidation) => this.toDto(liquidation));
  }

  async getLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
  ): Promise<LiquidationDetailDto> {
    const membership = await requireFinanceMembership(
      this.prisma,
      tenantId,
      membershipId,
      (roles) => this.validators.isAdminOrOperator(roles),
    );
    if (!this.validators.isAdminOrOperator(membership.roles)) {
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

    return this.toDetailDto(liq, {
      charges: liq.charges.map((c) => ({
        unitId: c.unit.id,
        unitCode: c.unit.code,
        unitLabel: c.unit.label,
        amountMinor: c.amount,
      })),
    });
  }

  async createDraft(
    tenantId: string,
    membershipId: string,
    dto: CreateLiquidationDraftDto,
  ): Promise<LiquidationDetailDto> {
    return this.prisma.$transaction(async (tx) => {
      const membership = await requireFinanceMembership(
        tx,
        tenantId,
        membershipId,
        (roles) => this.validators.isAdminOrOperator(roles),
      );
      if (!this.validators.isAdminOrOperator(membership.roles)) {
        throw new ForbiddenException('Solo administradores pueden generar liquidaciones');
      }

      const building = await tx.building.findFirst({
        where: { id: dto.buildingId, tenantId, deletedAt: null },
        select: { id: true },
      });

      if (!building) {
        throw new NotFoundException(`Building not found or does not belong to this tenant`);
      }

      const existingPublished = await tx.liquidation.findFirst({
        where: {
          tenantId,
          buildingId: dto.buildingId,
          period: dto.period,
          status: 'PUBLISHED',
        },
        select: { id: true },
      });

      if (existingPublished) {
        throw new ConflictException(
          `Ya existe una liquidación publicada para el período ${dto.period} en este edificio`,
        );
      }

      const pendingSharedExpenses = await tx.expense.count({
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

      const buildingExpenses = await tx.expense.findMany({
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

          const sharedExpenses = await tx.expense.findMany({
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
                where: { tenantId, buildingId: dto.buildingId },
              },
            },
          });

      const allocatedSharedExpenses = sharedExpenses.filter((expense) => expense.allocations.length > 0);

      const adjustments = await tx.adjustment.findMany({
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

      const billableUnits = await tx.unit.findMany({
        where: { tenantId, buildingId: dto.buildingId, isBillable: true },
        include: { unitCategory: { select: { coefficient: true, id: true } } },
        orderBy: { code: 'asc' },
      });

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

      for (const expense of allocatedSharedExpenses) {
        const allocation = expense.allocations[0];
        if (allocation && allocation.amountMinor !== null) {
          allExpenses.push({
            expenseId: expense.id,
            categoryName: expense.category.name,
            vendorName: expense.vendor?.name ?? null,
            amountMinor: allocation.amountMinor,
            currencyCode: expense.currencyCode,
            invoiceDate: expense.invoiceDate,
            description: expense.description,
            type: 'EXPENSE',
          });
        }
      }

      const expenseSnapshotItems: LiquidationExpenseSnapshotItem[] = allExpenses.map((expense) => ({
        expenseId: expense.expenseId,
        categoryName: expense.categoryName,
        vendorName: expense.vendorName,
        amountMinor: expense.amountMinor,
        currencyCode: expense.currencyCode,
        invoiceDate: expense.invoiceDate.toISOString(),
        description: expense.description,
        type: expense.type,
      }));

      const totalsByCurrency: Record<string, number> = {};
      for (const expense of allExpenses) {
        totalsByCurrency[expense.currencyCode] = this.safeAddAmountMinor(
          totalsByCurrency[expense.currencyCode] ?? 0,
          expense.amountMinor,
          `totalsByCurrency.${expense.currencyCode}`,
        );
      }

      for (const adjustment of adjustments) {
        expenseSnapshotItems.push({
          expenseId: `ADJ-${adjustment.id}`,
          categoryName: adjustment.category.name,
          vendorName: null,
          amountMinor: adjustment.amountMinor,
          currencyCode: adjustment.currencyCode,
          invoiceDate: adjustment.sourceInvoiceDate.toISOString(),
          description: `Ajuste retroactivo: ${adjustment.reason}`,
          type: 'ADJUSTMENT',
          sourcePeriod: adjustment.sourcePeriod,
        });

        totalsByCurrency[adjustment.currencyCode] = this.safeAddAmountMinor(
          totalsByCurrency[adjustment.currencyCode] ?? 0,
          adjustment.amountMinor,
          `totalsByCurrency.${adjustment.currencyCode}`,
        );
      }

      if (allExpenses.length === 0 && adjustments.length === 0) {
        throw new BadRequestException(
          `No hay gastos VALIDADOS ni ajustes para el período ${dto.period} en este edificio. ` +
            `Registrá gastos propios del edificio o verificá que los gastos comunes tengan asignación a este edificio.`,
        );
      }

      const totalAmountMinor = this.requireCurrencyTotal(totalsByCurrency, dto.baseCurrency);
      const chargesPreview = this.calculateDistribution(
        billableUnits,
        totalAmountMinor,
        dto.buildingId,
      );

      const created = await createLiquidationDraftRecord(tx, {
        createAuditLogRequired: (input, client) => this.auditService.createLogRequired(input, client),
      }, {
        tenantId,
        buildingId: dto.buildingId,
        period: dto.period,
        baseCurrency: dto.baseCurrency,
        totalAmountMinor,
        totalsByCurrency,
        expenseSnapshot: expenseSnapshotItems,
        unitCount: billableUnits.length,
        generatedByMembershipId: membership.id,
      });

      return this.toDetailDto(created, {
        charges: chargesPreview,
      });
    });
  }

  async reviewLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
  ): Promise<LiquidationResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const membership = await requireFinanceMembership(
        tx,
        tenantId,
        membershipId,
        (roles) => this.validators.isAdminOrOperator(roles),
      );
      if (!this.validators.isAdminOrOperator(membership.roles)) {
        throw new ForbiddenException('Acceso denegado');
      }

      const updated = await reviewLiquidationRecord(tx, {
        createAuditLogRequired: (input, client) => this.auditService.createLogRequired(input, client),
      }, {
        tenantId,
        liquidationId,
        membershipId: membership.id,
      });

      return this.toDto(updated);
    });
  }

  /**
   * Publishes a reviewed liquidation transactionally.
   *
   * The update is idempotent, persists the publication snapshot and audit log
   * inside the same transaction, and only emits charge-notification side
   * effects after the database commit succeeds.
   */
  async publishLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
    dto: PublishLiquidationDto,
  ): Promise<LiquidationResponseDto> {
    const result = await this.publicationUseCase.execute(
      tenantId,
      liquidationId,
      membershipId,
      dto,
      'post-commit',
    );

    return result;
  }

  /**
   * Cancels a draft or reviewed liquidation transactionally.
   *
   * The cancellation keeps the liquidation record and audit trail intact,
   * rejects attempts to cancel published liquidations, and preserves the
   * irreversible financial history for already persisted states.
   */
  async cancelLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
    options: CancelLiquidationOptions = {},
  ): Promise<LiquidationResponseDto> {
    const membership = await requireFinanceMembership(
      this.prisma,
      tenantId,
      membershipId,
      (roles) => this.validators.isAdminOrOperator(roles),
    );
    if (!this.validators.isAdminOrOperator(membership.roles)) {
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
          canceledByMembershipId: membership.id,
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
        await this.auditService.createLogRequired(
          {
            tenantId,
            actorMembershipId: membership.id,
            action: 'LIQUIDATION_CANCEL',
            entityType: 'Liquidation',
            entityId: liquidationId,
            metadata: {
              period: current.period,
              buildingId: current.buildingId,
              previousStatus: current.status,
              canceledAt: canceledAt.toISOString(),
              reason: cancellationReason,
            },
          },
          tx,
        );
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
    chargePeriod: string | null;
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
    const totalsByCurrency = parseTotalsByCurrency(liq.totalsByCurrency);

    return {
      id: liq.id,
      tenantId: liq.tenantId,
      buildingId: liq.buildingId,
      period: liq.period,
      chargePeriod: liq.chargePeriod,
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

  private toDetailDto(
    liq: {
      id: string;
      tenantId: string;
      buildingId: string;
      period: string;
      chargePeriod: string | null;
      status: 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'CANCELED';
      baseCurrency: string;
      totalAmountMinor: number;
      totalsByCurrency: unknown;
      expenseSnapshot: unknown;
      publicationSnapshot: unknown;
      unitCount: number;
      generatedAt: Date;
      reviewedAt: Date | null;
      publishedAt: Date | null;
      canceledAt: Date | null;
      createdAt: Date;
    },
    options: {
      expenses?: ReadonlyArray<PublishedExpenseSnapshot>;
      charges: Array<{
        unitId: string;
        unitCode: string;
        unitLabel: string | null;
        amountMinor: number;
      }>;
    },
  ): LiquidationDetailDto {
    const publicationSnapshot =
      liq.status === 'PUBLISHED'
        ? parseLiquidationPublicationSnapshot(liq.publicationSnapshot)
        : null;

    if (publicationSnapshot) {
      return {
        ...this.toDto(liq),
        publicationSnapshotStatus: 'AVAILABLE',
        expenses: publicationSnapshot.expenses.map((expense) => ({
          id: expense.expenseId,
          categoryName: expense.categoryName,
          vendorName: expense.vendorName,
          amountMinor: expense.amountMinor,
          currencyCode: expense.currencyCode,
          invoiceDate: new Date(expense.invoiceDate),
          description: expense.description,
        })),
        chargesPreview: publicationSnapshot.allocations.map((allocation) => ({
          unitId: allocation.unitId,
          unitCode: allocation.unitCode,
          unitLabel: allocation.unitLabel,
          amountMinor: allocation.amountMinor,
        })),
      };
    }

    const expenseSnapshot = this.parseExpenseSnapshot(liq.expenseSnapshot);

    return {
      ...this.toDto(liq),
      publicationSnapshotStatus: 'LEGACY',
      expenses: expenseSnapshot.map((expense) => ({
        id: expense.expenseId,
        categoryName: expense.categoryName,
        vendorName: expense.vendorName,
        amountMinor: expense.amountMinor,
        currencyCode: expense.currencyCode,
        invoiceDate: new Date(expense.invoiceDate),
        description: expense.description,
      })),
      chargesPreview: options.charges,
    };
  }

  private safeAddAmountMinor(left: number, right: number, field: string): number {
    const total = left + right;

    if (!Number.isSafeInteger(total) || total < 0) {
      throw new BadRequestException(`Liquidation ${field} is invalid`);
    }

    return total;
  }

  private requireCurrencyTotal(
    totalsByCurrency: Record<string, number>,
    baseCurrency: string,
  ): number {
    const total = totalsByCurrency[baseCurrency];

    if (total === undefined) {
      throw new BadRequestException(
        `No se puede generar la liquidación porque no hay totales para la moneda base ${baseCurrency}`,
      );
    }

    return total;
  }

  private isSerializationConflict(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
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
      if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor < 0) {
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

      const parsedInvoiceDate = new Date(invoiceDate);
      if (Number.isNaN(parsedInvoiceDate.getTime())) {
        throw new BadRequestException(`Liquidation expense snapshot item ${index} has invalid invoiceDate`);
      }

      return {
        expenseId,
        categoryName,
        vendorName,
        amountMinor,
        currencyCode,
        invoiceDate: parsedInvoiceDate.toISOString(),
        description,
        type,
        sourcePeriod: sourcePeriod ?? undefined,
      };
    });
  }

  private getPublicationSnapshotExpenses(
    value: unknown,
  ): ReadonlyArray<PublishedExpenseSnapshot> {
    return this.parseExpenseSnapshot(value).map((expense) => ({
      expenseId: expense.expenseId,
      categoryName: expense.categoryName,
      vendorName: expense.vendorName,
      amountMinor: expense.amountMinor,
      currencyCode: expense.currencyCode,
      invoiceDate: expense.invoiceDate,
      description: expense.description,
      type: expense.type,
      ...(expense.sourcePeriod ? { sourcePeriod: expense.sourcePeriod } : {}),
    }));
  }

}
