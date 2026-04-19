import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import {
  CreateAdjustmentDto,
  AdjustmentResponseDto,
} from './expense-ledger.dto';

@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validators: FinanzasValidators,
    private readonly auditService: AuditService,
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
      action: 'OTHER' as any,
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

    const updated = await this.prisma.adjustment.update({
      where: { id: adjustmentId },
      data: {
        status: 'VALIDATED',
        validatedByMembershipId: membershipId,
        validatedAt: new Date(),
      },
      include: {
        category: { select: { name: true } },
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'OTHER' as any,
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
      status?: string;
    },
  ): Promise<AdjustmentResponseDto[]> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden ver ajustes');
    }

    const where: any = { tenantId };
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

    return adjustments.map((a: any) => this.toDto(a));
  }

  private toDto(
    adjustment: any,
  ): AdjustmentResponseDto {
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
      status: adjustment.status as 'DRAFT' | 'VALIDATED' | 'VOIDED',
      createdByMembershipId: adjustment.createdByMembershipId,
      validatedByMembershipId: adjustment.validatedByMembershipId,
      validatedAt: adjustment.validatedAt,
      createdAt: adjustment.createdAt,
      updatedAt: adjustment.updatedAt,
    };
  }
}