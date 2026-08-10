import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { AdjustmentStatus, AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { CurrencyConversionService } from './currency-conversion.service';
import {
  CreateAdjustmentDto,
  AdjustmentResponseDto,
} from './expense-ledger.dto';

type AdjustmentWithCategoryName = Prisma.AdjustmentGetPayload<{
  include: {
    category: {
      select: {
        name: true;
      };
    };
  };
}>;

@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validators: FinanzasValidators,
    private readonly auditService: AuditService,
    private readonly currencyConversionService: CurrencyConversionService,
  ) {}

  async createAdjustment(
    tenantId: string,
    membershipId: string,
    userRoles: string[],
    dto: CreateAdjustmentDto,
  ): Promise<AdjustmentResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden registrar ajustes');
    }

    await this.validators.validateBuildingBelongsToTenant(tenantId, dto.buildingId);

    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: { id: dto.categoryId, tenantId, isActive: true },
    });
    if (!category) {
      throw new NotFoundException(`Rubro de gasto no encontrado: ${dto.categoryId}`);
    }

    const sourceInvoiceDate = new Date(dto.sourceInvoiceDate);
    const year = sourceInvoiceDate.getFullYear();
    const month = String(sourceInvoiceDate.getMonth() + 1).padStart(2, '0');
    const sourcePeriod = `${year}-${month}`;

    const targetPeriod =
      dto.targetPeriod ||
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    const adjustment = await this.prisma.adjustment.create({
      data: {
        tenantId,
        buildingId: dto.buildingId,
        sourceInvoiceDate,
        sourcePeriod,
        targetPeriod,
        categoryId: dto.categoryId,
        amountMinor: dto.amountMinor,
        currencyCode: dto.currencyCode,
        reason: dto.reason,
        status: 'DRAFT',
        createdByMembershipId: membershipId,
      },
      include: {
        category: { select: { name: true } },
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: AuditAction.OTHER,
      entityType: 'Adjustment',
      entityId: adjustment.id,
      metadata: {
        sourcePeriod,
        targetPeriod,
        amountMinor: dto.amountMinor,
        currencyCode: dto.currencyCode,
        reason: dto.reason,
      },
    });

    return this.toDto(adjustment);
  }

  async validateAdjustment(
    tenantId: string,
    adjustmentId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<AdjustmentResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden validar ajustes');
    }

    const adjustment = await this.prisma.adjustment.findFirst({
      where: { id: adjustmentId, tenantId },
      include: { category: { select: { name: true } } },
    });

    if (!adjustment) {
      throw new NotFoundException(`Ajuste no encontrado: ${adjustmentId}`);
    }

    if (adjustment.status !== 'DRAFT') {
      throw new BadRequestException(
        `Solo se pueden validar ajustes en DRAFT. Estado actual: ${adjustment.status}`,
      );
    }

    const conversionSnapshot = await this.buildAdjustmentConversionSnapshot(
      tenantId,
      adjustment,
    );

    const updated = await this.prisma.adjustment.update({
      where: { id: adjustmentId },
      data: {
        status: 'VALIDATED',
        validatedByMembershipId: membershipId,
        validatedAt: new Date(),
        functionalAmountMinor: conversionSnapshot.functionalAmountMinor,
        functionalCurrencyCode: conversionSnapshot.functionalCurrencyCode,
        exchangeRateId: conversionSnapshot.exchangeRateId,
        exchangeRateValue: conversionSnapshot.exchangeRateValue,
        exchangeRateDirection: conversionSnapshot.exchangeRateDirection,
        exchangeRateEffectiveAt: conversionSnapshot.exchangeRateEffectiveAt,
        conversionDate: conversionSnapshot.conversionDate,
      },
      include: {
        category: { select: { name: true } },
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: AuditAction.OTHER,
      entityType: 'Adjustment',
      entityId: adjustmentId,
      metadata: {
        sourcePeriod: adjustment.sourcePeriod,
        targetPeriod: adjustment.targetPeriod,
      },
    });

    return this.toDto(updated);
  }

  async listAdjustments(
    tenantId: string,
    userRoles: string[],
    filters?: {
      buildingId?: string;
      targetPeriod?: string;
      status?: AdjustmentStatus;
    },
  ): Promise<AdjustmentResponseDto[]> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden ver ajustes');
    }

    const where: Prisma.AdjustmentWhereInput = { tenantId };
    if (filters?.buildingId) {
      where.buildingId = filters.buildingId;
    }
    if (filters?.targetPeriod) {
      where.targetPeriod = filters.targetPeriod;
    }
    if (filters?.status) {
      where.status = filters.status;
    }

    const adjustments = await this.prisma.adjustment.findMany({
      where,
      include: {
        category: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return adjustments.map((adjustment) => this.toDto(adjustment));
  }

  private toConversionDate(sourceInvoiceDate: Date): string {
    const year = sourceInvoiceDate.getUTCFullYear();
    const month = String(sourceInvoiceDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(sourceInvoiceDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private async buildAdjustmentConversionSnapshot(
    tenantId: string,
    adjustment: {
      amountMinor: number;
      currencyCode: string;
      sourceInvoiceDate: Date;
    },
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
      amount: adjustment.amountMinor,
      originalCurrency: adjustment.currencyCode as Parameters<
        typeof this.currencyConversionService.convert
      >[0]['originalCurrency'],
      functionalCurrency: tenant.functionalCurrency as Parameters<
        typeof this.currencyConversionService.convert
      >[0]['functionalCurrency'],
      conversionDate: this.toConversionDate(adjustment.sourceInvoiceDate),
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

  private toDto(adjustment: AdjustmentWithCategoryName): AdjustmentResponseDto {
    return {
      id: adjustment.id,
      tenantId: adjustment.tenantId,
      buildingId: adjustment.buildingId,
      sourceInvoiceDate: adjustment.sourceInvoiceDate,
      sourcePeriod: adjustment.sourcePeriod,
      targetPeriod: adjustment.targetPeriod,
      categoryId: adjustment.categoryId,
      categoryName: adjustment.category?.name || '',
      amountMinor: adjustment.amountMinor,
      currencyCode: adjustment.currencyCode,
      reason: adjustment.reason,
      status: adjustment.status,
      createdByMembershipId: adjustment.createdByMembershipId,
      validatedByMembershipId: adjustment.validatedByMembershipId,
      validatedAt: adjustment.validatedAt,
      functionalAmountMinor: adjustment.functionalAmountMinor ?? null,
      functionalCurrencyCode: adjustment.functionalCurrencyCode ?? null,
      exchangeRateId: adjustment.exchangeRateId ?? null,
      exchangeRateValue:
        adjustment.exchangeRateValue === null || adjustment.exchangeRateValue === undefined
          ? null
          : adjustment.exchangeRateValue.toString(),
      exchangeRateDirection: adjustment.exchangeRateDirection ?? null,
      exchangeRateEffectiveAt: adjustment.exchangeRateEffectiveAt ?? null,
      conversionDate: adjustment.conversionDate ?? null,
      createdAt: adjustment.createdAt,
      updatedAt: adjustment.updatedAt,
    };
  }
}
