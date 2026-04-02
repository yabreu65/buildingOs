import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { MovementAllocationService } from './movement-allocation.service';
import {
  CreateIncomeDto,
  UpdateIncomeDto,
  IncomeResponseDto,
} from './expense-ledger.dto';

@Injectable()
export class IncomesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
    private readonly movementAllocationService: MovementAllocationService,
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

    const income = await this.prisma.income.create({
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

    // Crear allocations si es TENANT_SHARED o UNIT_GROUP
    if ((scopeType === 'TENANT_SHARED' || scopeType === 'UNIT_GROUP') && dto.allocations) {
      await this.movementAllocationService.createForIncome(
        tenantId,
        income.id,
        dto.amountMinor,
        dto.currencyCode,
        dto.allocations,
        membershipId,
      );
    }

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

    const income = await this.prisma.income.findFirst({
      where: { id: incomeId, tenantId },
      include: { category: true },
    });

    if (!income) {
      throw new NotFoundException(`Ingreso no encontrado: ${incomeId}`);
    }

    // If changing category, validate it's INCOME type
    if (dto.categoryId && dto.categoryId !== income.categoryId) {
      const newCategory = await this.prisma.expenseLedgerCategory.findFirst({
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

    const updated = await this.prisma.income.update({
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

  async recordIncome(
    tenantId: string,
    incomeId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<IncomeResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden registrar ingresos');
    }

    const income = await this.prisma.income.findFirst({
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

    const updated = await this.prisma.income.update({
      where: { id: incomeId },
      data: {
        status: 'RECORDED',
        recordedByMembershipId: membershipId,
        recordedAt: new Date(),
      },
      include: { category: true },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'INCOME_RECORD',
      entityType: 'Income',
      entityId: incomeId,
      metadata: { previousStatus: income.status, newStatus: 'RECORDED' },
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

    const income = await this.prisma.income.findFirst({
      where: { id: incomeId, tenantId },
      include: { category: true },
    });

    if (!income) {
      throw new NotFoundException(`Ingreso no encontrado: ${incomeId}`);
    }

    const updated = await this.prisma.income.update({
      where: { id: incomeId },
      data: {
        status: 'VOID',
        voidedByMembershipId: membershipId,
        voidedAt: new Date(),
      },
      include: { category: true },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'INCOME_VOID',
      entityType: 'Income',
      entityId: incomeId,
      metadata: { previousStatus: income.status, newStatus: 'VOID' },
    });

    return this.toDto(updated);
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
      createdAt: income.createdAt,
      updatedAt: income.updatedAt,
    };
  }
}
