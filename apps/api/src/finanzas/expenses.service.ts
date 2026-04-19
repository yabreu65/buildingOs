import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateExpenseDto,
  UpdateExpenseDto,
  ExpenseResponseDto,
} from './expense-ledger.dto';
import { FinanzasValidators } from './finanzas.validators';
import { MovementAllocationService } from './movement-allocation.service';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
    private readonly movementAllocationService: MovementAllocationService,
  ) {}

  async listExpenses(
    tenantId: string,
    userRoles: string[],
    query: {
      buildingId?: string;
      period?: string;
      status?: string;
      categoryId?: string;
      scopeType?: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';
      limit?: number;
      offset?: number;
    },
  ): Promise<ExpenseResponseDto[]> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden ver gastos',
      );
    }

    const expenses = await this.prisma.expense.findMany({
      where: {
        tenantId,
        buildingId: query.buildingId,
        period: query.period,
        status: query.status as 'DRAFT' | 'VALIDATED' | 'VOID' | undefined,
        categoryId: query.categoryId,
        ...(query.scopeType && { scopeType: query.scopeType }),
        ...(query.buildingId && !query.scopeType && { scopeType: 'BUILDING' }),
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
        allocations: true,
      },
      orderBy: { invoiceDate: 'desc' },
      take: query.limit ?? 100,
      skip: query.offset ?? 0,
    });

    return expenses.map(this.toDto);
  }

  async getExpense(
    tenantId: string,
    expenseId: string,
    userRoles: string[],
  ): Promise<ExpenseResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Acceso denegado');
    }

    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, tenantId },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    if (!expense) {
      throw new NotFoundException(`Gasto no encontrado: ${expenseId}`);
    }

    return this.toDto(expense);
  }

  async createExpense(
    tenantId: string,
    membershipId: string,
    userRoles: string[],
    dto: CreateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(
        'Solo administradores pueden registrar gastos',
      );
    }

    const scopeType = dto.scopeType ?? 'BUILDING';

    // Validar scope-specific requirements
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

    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: { id: dto.categoryId, tenantId, isActive: true },
    });
    if (!category) {
      throw new NotFoundException(`Rubro de gasto no encontrado: ${dto.categoryId}`);
    }

    // Validate scope compatibility: BUILDING scope requires BUILDING catalogScope, TENANT_SHARED requires CONDOMINIUM_COMMON
    if (scopeType === 'BUILDING' && category.catalogScope !== 'BUILDING') {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'CATEGORY_SCOPE_MISMATCH',
        message: `El rubro "${category.name}" es de scope CONDOMINIUM_COMMON y no puede usarse para gastos BUILDING.`,
      });
    }
    if (scopeType === 'TENANT_SHARED' && category.catalogScope !== 'CONDOMINIUM_COMMON') {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'CATEGORY_SCOPE_MISMATCH',
        message: `El rubro "${category.name}" es de scope BUILDING y no puede usarse para gastos TENANT_SHARED.`,
      });
    }

    if (dto.vendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: dto.vendorId, tenantId },
      });
      if (!vendor) {
        throw new NotFoundException(`Proveedor no encontrado: ${dto.vendorId}`);
      }
    }

    // Derivar liquidationPeriod desde invoiceDate (nueva semántica)
    const invoiceDate = new Date(dto.invoiceDate);
    const year = invoiceDate.getFullYear();
    const month = String(invoiceDate.getMonth() + 1).padStart(2, '0');
    const liquidationPeriod = `${year}-${month}`;

    // Verificar si el período de devengo está publicado para este edificio (solo para BUILDING scope)
    if (scopeType === 'BUILDING' && dto.buildingId) {
      const publishedLiq = await this.prisma.liquidation.findFirst({
        where: {
          tenantId,
          buildingId: dto.buildingId,
          period: liquidationPeriod,
          status: 'PUBLISHED',
        },
        select: { id: true, period: true },
      });

      if (publishedLiq) {
        // Calcular período objetivo (próximo mes abierto o actual)
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;
        const targetPeriod = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

        throw new BadRequestException({
          code: 'PERIOD_PUBLISHED',
          message: `El período ${liquidationPeriod} ya está liquidado y publicado. Registre este gasto como Ajuste para cobrarse en ${targetPeriod}.`,
          publishedPeriod: liquidationPeriod,
          suggestedTargetPeriod: targetPeriod,
          canCreateAdjustment: true,
        });
      }
    }

    const expense = await this.prisma.expense.create({
      data: {
        tenantId,
        buildingId: dto.buildingId ?? null,
        period: dto.period, // LEGACY: mantener por compatibilidad
        liquidationPeriod, // NUEVO: período de devengo derivado de invoiceDate
        categoryId: dto.categoryId,
        vendorId: dto.vendorId ?? null,
        amountMinor: dto.amountMinor,
        currencyCode: dto.currencyCode,
        invoiceDate,
        description: dto.description ?? null,
        attachmentFileKey: dto.attachmentFileKey ?? null,
        scopeType,
        unitGroupId: dto.unitGroupId ?? null,
        createdByMembershipId: membershipId,
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    // Crear allocations si es TENANT_SHARED o UNIT_GROUP
    if ((scopeType === 'TENANT_SHARED' || scopeType === 'UNIT_GROUP') && dto.allocations) {
      await this.movementAllocationService.createForExpense(
        tenantId,
        expense.id,
        dto.amountMinor,
        dto.currencyCode,
        dto.allocations,
        membershipId,
      );
    }

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'EXPENSE_CREATE',
      entityType: 'Expense',
      entityId: expense.id,
      metadata: {
        period: dto.period,
        liquidationPeriod,
        buildingId: dto.buildingId ?? null,
        scopeType,
        amountMinor: dto.amountMinor,
        currencyCode: dto.currencyCode,
      },
    });

    return this.toDto(expense);
  }

  async updateExpense(
    tenantId: string,
    expenseId: string,
    membershipId: string,
    userRoles: string[],
    dto: UpdateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Acceso denegado');
    }

    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, tenantId },
    });

    if (!expense) {
      throw new NotFoundException(`Gasto no encontrado: ${expenseId}`);
    }

    if (expense.status !== 'DRAFT') {
      throw new BadRequestException(
        `Solo se pueden editar gastos en DRAFT. Estado actual: ${expense.status}`,
      );
    }

    if (dto.categoryId && dto.categoryId !== expense.categoryId) {
      const category = await this.prisma.expenseLedgerCategory.findFirst({
        where: { id: dto.categoryId, tenantId, isActive: true },
      });
      if (!category) {
        throw new NotFoundException(`Rubro de gasto no encontrado: ${dto.categoryId}`);
      }
    }

    if (dto.vendorId !== undefined && dto.vendorId !== null) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: dto.vendorId, tenantId },
      });
      if (!vendor) {
        throw new NotFoundException(`Proveedor no encontrado: ${dto.vendorId}`);
      }
    }

    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        amountMinor: dto.amountMinor ?? expense.amountMinor,
        currencyCode: dto.currencyCode ?? expense.currencyCode,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : expense.invoiceDate,
        categoryId: dto.categoryId ?? expense.categoryId,
        vendorId: dto.vendorId !== undefined ? dto.vendorId : expense.vendorId,
        description: dto.description !== undefined ? dto.description : expense.description,
        attachmentFileKey:
          dto.attachmentFileKey !== undefined
            ? dto.attachmentFileKey
            : expense.attachmentFileKey,
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'EXPENSE_UPDATE',
      entityType: 'Expense',
      entityId: expenseId,
      metadata: dto,
    });

    return this.toDto(updated);
  }

  async validateExpense(
    tenantId: string,
    expenseId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<ExpenseResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Acceso denegado');
    }

    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, tenantId },
    });

    if (!expense) {
      throw new NotFoundException(`Gasto no encontrado: ${expenseId}`);
    }

    if (expense.status !== 'DRAFT') {
      throw new BadRequestException(
        `Solo se pueden validar gastos en DRAFT. Estado actual: ${expense.status}`,
      );
    }

    // Verificar campos requeridos para VALIDATED
    if (!expense.amountMinor || !expense.currencyCode || !expense.categoryId || !expense.period || !expense.invoiceDate) {
      throw new BadRequestException(
        'Para validar un gasto se requiere: amountMinor, currencyCode, categoryId, period, invoiceDate',
      );
    }

    // Verificar que tenga proveedor asignado (obligatorio desde ahora)
    if (!expense.vendorId) {
      throw new BadRequestException(
        'Para validar un gasto debés asignar un proveedor. Seleccioná el proveedor en el gasto e intentá nuevamente.',
      );
    }

    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        status: 'VALIDATED',
        validatedByMembershipId: membershipId,
        validatedAt: new Date(),
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'EXPENSE_VALIDATE',
      entityType: 'Expense',
      entityId: expenseId,
      metadata: {
        period: expense.period,
        amountMinor: expense.amountMinor,
        currencyCode: expense.currencyCode,
      },
    });

    return this.toDto(updated);
  }

  async voidExpense(
    tenantId: string,
    expenseId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<ExpenseResponseDto> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Acceso denegado');
    }

    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, tenantId },
    });

    if (!expense) {
      throw new NotFoundException(`Gasto no encontrado: ${expenseId}`);
    }

    if (expense.status === 'VOID') {
      throw new BadRequestException('El gasto ya está anulado');
    }

    const updated = await this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        status: 'VOID',
        voidedByMembershipId: membershipId,
        voidedAt: new Date(),
      },
      include: {
        category: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'EXPENSE_VOID',
      entityType: 'Expense',
      entityId: expenseId,
      metadata: { period: expense.period, reason: 'void requested by admin' },
    });

    return this.toDto(updated);
  }

  private toDto(
    expense: {
      id: string;
      tenantId: string;
      buildingId: string | null;
      period: string;
      liquidationPeriod: string | null;
      categoryId: string;
      vendorId: string | null;
      amountMinor: number;
      currencyCode: string;
      invoiceDate: Date;
      description: string | null;
      attachmentFileKey: string | null;
      status: 'DRAFT' | 'VALIDATED' | 'VOID';
      scopeType: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';
      unitGroupId: string | null;
      createdAt: Date;
      updatedAt: Date;
      category: { name: string };
      vendor: { name: string } | null;
    },
  ): ExpenseResponseDto {
    return {
      id: expense.id,
      tenantId: expense.tenantId,
      buildingId: expense.buildingId,
      period: expense.period,
      liquidationPeriod: expense.liquidationPeriod,
      categoryId: expense.categoryId,
      categoryName: expense.category.name,
      vendorId: expense.vendorId,
      vendorName: expense.vendor?.name ?? null,
      amountMinor: expense.amountMinor,
      currencyCode: expense.currencyCode,
      invoiceDate: expense.invoiceDate,
      description: expense.description,
      attachmentFileKey: expense.attachmentFileKey,
      status: expense.status,
      scopeType: expense.scopeType,
      unitGroupId: expense.unitGroupId,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
    };
  }

  // ── Import from Excel ──────────────────────────────────────────────────

  async importExpensesFromExcel(
    tenantId: string,
    membershipId: string,
    userRoles: string[],
    period: string,
    rows: Array<{
      fecha: string;
      descripcion: string;
      monto: number;
      moneda: string;
      edificio: string;
      categoria: string;
      proveedor?: string;
    }>,
  ): Promise<{ successCount: number; failureCount: number; errors: { rowIndex: number; reason: string }[] }> {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException('Solo administradores pueden importar gastos');
    }

    // Preload data
    const [buildings, categories, vendors] = await Promise.all([
      this.prisma.building.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      this.prisma.expenseLedgerCategory.findMany({
        where: { tenantId, movementType: 'EXPENSE', isActive: true },
        select: { id: true, name: true },
      }),
      this.prisma.vendor.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    ]);

    const buildingsByName = new Map(buildings.map((b) => [b.name.toLowerCase(), b.id]));
    const categoriesByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    const vendorsByName = new Map(vendors.map((v) => [v.name.toLowerCase(), v.id]));

    const errors: { rowIndex: number; reason: string }[] = [];
    let successCount = 0;

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      try {
        // Validate required fields
        if (!row.fecha || !row.descripcion || !row.monto || !row.moneda || !row.edificio || !row.categoria) {
          throw new Error('Faltan campos requeridos (fecha, descripcion, monto, moneda, edificio, categoria)');
        }

        // Parse date
        const invoiceDate = this.parseDate(row.fecha);
        if (!invoiceDate) throw new Error(`Fecha inválida: ${row.fecha}`);

        // Resolve building
        const buildingKey = row.edificio.toLowerCase().trim();
        let buildingId: string | null = null;
        let scopeType: 'BUILDING' | 'TENANT_SHARED' = 'BUILDING';

        if (buildingKey === 'comunes' || buildingKey === 'áreas comunes' || buildingKey === 'tenant_shared') {
          buildingId = null;
          scopeType = 'TENANT_SHARED';
        } else {
          buildingId = buildingsByName.get(buildingKey) ?? null;
          if (!buildingId) throw new Error(`Edificio no encontrado: ${row.edificio}`);
        }

        // Resolve category
        const categoryId = categoriesByName.get(row.categoria.toLowerCase().trim()) ?? null;
        if (!categoryId) throw new Error(`Categoría no encontrada: ${row.categoria}`);

        // Resolve vendor (optional)
        const vendorId = row.proveedor ? (vendorsByName.get(row.proveedor.toLowerCase().trim()) ?? null) : null;

        // Validate currency
        const currencyCode = (row.moneda ?? 'USD').toUpperCase().trim();
        if (!['USD', 'VES', 'ARS'].includes(currencyCode)) {
          throw new Error(`Moneda inválida: ${row.moneda}`);
        }

        // Validate monto is a number
        const monto = typeof row.monto === 'number' ? row.monto : parseFloat(String(row.monto));
        if (isNaN(monto) || monto <= 0) {
          throw new Error(`Monto inválido: ${row.monto}`);
        }

        // Create expense
        await this.prisma.expense.create({
          data: {
            tenantId,
            buildingId,
            period,
            categoryId,
            vendorId,
            scopeType,
            amountMinor: Math.round(monto * 100),
            currencyCode,
            invoiceDate,
            description: row.descripcion,
            status: 'DRAFT',
            createdByMembershipId: membershipId,
          },
        });

        successCount++;
      } catch (err) {
        errors.push({
          rowIndex: i + 1,
          reason: err instanceof Error ? err.message : 'Error desconocido',
        });
      }
    }

    return { successCount, failureCount: errors.length, errors };
  }

  // ── Helper ────────────────────────────────────────────────────────────

  private parseDate(dateStr: string): Date | null {
    // Try DD/MM/YYYY
    const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      const day = parseInt(match[1]!, 10);
      const month = parseInt(match[2]!, 10);
      const year = parseInt(match[3]!, 10);
      const d = new Date(year, month - 1, day);
      return d.getMonth() === month - 1 ? d : null;
    }
    // Try YYYY-MM-DD
    try {
      const d = new Date(dateStr);
      return !isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
}
