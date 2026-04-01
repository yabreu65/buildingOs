import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ChargeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateLiquidationDraftDto,
  PublishLiquidationDto,
  LiquidationResponseDto,
  LiquidationDetailDto,
} from './expense-ledger.dto';
import { FinanzasValidators } from './finanzas.validators';

@Injectable()
export class LiquidationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
  ) {}

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
    const expenseSnapshot = liq.expenseSnapshot as Array<{
      expenseId: string;
      categoryName: string;
      vendorName: string | null;
      amountMinor: number;
      currencyCode: string;
      invoiceDate: string;
      description: string | null;
    }>;

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

    // Cargar gastos VALIDATED del (building, period)
    const expenses = await this.prisma.expense.findMany({
      where: {
        tenantId,
        buildingId: dto.buildingId,
        period: dto.period,
        status: 'VALIDATED',
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    if (expenses.length === 0) {
      throw new BadRequestException(
        `No hay gastos VALIDADOS para el período ${dto.period} en este edificio`,
      );
    }

    // Calcular totales por moneda
    const totalsByCurrency: Record<string, number> = {};
    for (const expense of expenses) {
      totalsByCurrency[expense.currencyCode] =
        (totalsByCurrency[expense.currencyCode] ?? 0) + expense.amountMinor;
    }

    // Total en baseCurrency (solo gastos en esa moneda)
    const totalAmountMinor = totalsByCurrency[dto.baseCurrency] ?? 0;

    // Contar unidades billables
    const billableUnits = await this.prisma.unit.findMany({
      where: { buildingId: dto.buildingId, isBillable: true },
      include: { unitCategory: { select: { coefficient: true, id: true } } },
      orderBy: { code: 'asc' },
    });

    // Snapshot de expenses para auditoría
    const expenseSnapshot = expenses.map((e) => ({
      expenseId: e.id,
      categoryName: e.category.name,
      vendorName: e.vendor?.name ?? null,
      amountMinor: e.amountMinor,
      currencyCode: e.currencyCode,
      invoiceDate: e.invoiceDate.toISOString(),
      description: e.description,
    }));

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

    void this.auditService.createLog({
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
        expenseCount: expenses.length,
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

    const updated = await this.prisma.liquidation.update({
      where: { id: liquidationId },
      data: {
        status: 'REVIEWED',
        reviewedByMembershipId: membershipId,
        reviewedAt: new Date(),
      },
    });

    void this.auditService.createLog({
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

    if (liq.status !== 'DRAFT' && liq.status !== 'REVIEWED') {
      throw new BadRequestException(
        `Solo se puede publicar una liquidación en DRAFT o REVIEWED. Estado actual: ${liq.status}`,
      );
    }

    // Anti-duplicado: no puede existir otra PUBLISHED para (building, period)
    const existingPublished = await this.prisma.liquidation.findFirst({
      where: {
        tenantId,
        buildingId: liq.buildingId,
        period: liq.period,
        status: 'PUBLISHED',
        id: { not: liquidationId },
      },
    });

    if (existingPublished) {
      throw new ConflictException(
        `Ya existe una liquidación publicada para el período ${liq.period}`,
      );
    }

    // Cargar unidades billables con categorías para distribución
    const billableUnits = await this.prisma.unit.findMany({
      where: { buildingId: liq.buildingId, isBillable: true },
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

    await this.prisma.$transaction(async (tx) => {
      // Crear un Charge por unidad
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

      await tx.liquidation.update({
        where: { id: liquidationId },
        data: {
          status: 'PUBLISHED',
          publishedByMembershipId: membershipId,
          publishedAt: new Date(),
        },
      });
    });

    void this.auditService.createLog({
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

    const updated = await this.prisma.liquidation.findUniqueOrThrow({
      where: { id: liquidationId },
    });

    return this.toDto(updated);
  }

  async cancelLiquidation(
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

    if (liq.status === 'CANCELED') {
      throw new BadRequestException('La liquidación ya está cancelada');
    }

    // Si está publicada, verificar que no haya pagos aprobados sobre sus charges
    if (liq.status === 'PUBLISHED') {
      const approvedAllocations = await this.prisma.paymentAllocation.count({
        where: {
          tenantId,
          charge: { liquidationId, canceledAt: null },
          payment: { status: 'APPROVED' },
        },
      });

      if (approvedAllocations > 0) {
        throw new ConflictException(
          `No se puede cancelar: hay ${approvedAllocations} pago(s) aprobado(s) asignados a esta liquidación`,
        );
      }

      // Soft-delete de los charges generados
      await this.prisma.charge.updateMany({
        where: { liquidationId, tenantId, canceledAt: null },
        data: { canceledAt: new Date() },
      });
    }

    const updated = await this.prisma.liquidation.update({
      where: { id: liquidationId },
      data: {
        status: 'CANCELED',
        canceledByMembershipId: membershipId,
        canceledAt: new Date(),
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'LIQUIDATION_CANCEL',
      entityType: 'Liquidation',
      entityId: liquidationId,
      metadata: { period: liq.period, buildingId: liq.buildingId },
    });

    return this.toDto(updated);
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

    const hasCoefficients = billableUnits.every((u) => u.unitCategory !== null);

    if (hasCoefficients) {
      const sumCoef = billableUnits.reduce(
        (sum, u) => sum + (u.unitCategory!.coefficient),
        0,
      );

      if (sumCoef === 0) {
        return this.equalDistribution(billableUnits, totalAmountMinor);
      }

      // Largest Remainder
      const amounts = billableUnits.map((unit) => {
        const coef = unit.unitCategory!.coefficient;
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
    return {
      id: liq.id,
      tenantId: liq.tenantId,
      buildingId: liq.buildingId,
      period: liq.period,
      status: liq.status,
      baseCurrency: liq.baseCurrency,
      totalAmountMinor: liq.totalAmountMinor,
      totalsByCurrency: liq.totalsByCurrency as Record<string, number>,
      unitCount: liq.unitCount,
      generatedAt: liq.generatedAt,
      reviewedAt: liq.reviewedAt,
      publishedAt: liq.publishedAt,
      canceledAt: liq.canceledAt,
      createdAt: liq.createdAt,
    };
  }
}
