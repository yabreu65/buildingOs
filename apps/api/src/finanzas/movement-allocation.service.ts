import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';

export interface CreateAllocationInput {
  buildingId: string;
  percentage?: number;
  amountMinor?: number;
  currencyCode?: string;
}

@Injectable()
export class MovementAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
  ) {}

  /**
   * Valida que las allocations sean válidas:
   * - Si usan %, suma exacta 100
   * - Si usan montos, suma exacta = parentAmount
   * - Todos buildingId pertenecen al tenant
   */
  async validateAllocations(
    tenantId: string,
    allocations: CreateAllocationInput[],
    parentAmount: number,
    parentCurrency: string,
  ): Promise<void> {
    if (!allocations || allocations.length === 0) {
      throw new BadRequestException('Las allocations no pueden estar vacías');
    }

    // Verificar buildingIds
    const buildingIds = allocations.map((a) => a.buildingId);
    const buildings = await this.prisma.building.findMany({
      where: {
        id: { in: buildingIds },
        tenantId,
      },
    });

    if (buildings.length !== buildingIds.length) {
      throw new BadRequestException(
        'Algunos buildingIds no pertenecen al tenant o no existen',
      );
    }

    // Detectar modo: % o montos
    const hasPercentages = allocations.some((a) => a.percentage !== null && a.percentage !== undefined);
    const hasAmounts = allocations.some((a) => a.amountMinor !== null && a.amountMinor !== undefined);

    if (hasPercentages && hasAmounts) {
      throw new BadRequestException(
        'No puedes mezclar allocations por % y por monto',
      );
    }

    if (hasPercentages) {
      const totalPercentage = allocations.reduce((sum, a) => sum + (a.percentage ?? 0), 0);
      if (Math.abs(totalPercentage - 100) > 0.01) {
        throw new BadRequestException(
          `Los porcentajes deben sumar 100%, sumaron: ${totalPercentage}%`,
        );
      }
    } else if (hasAmounts) {
      // Verificar que todas las allocations tengan currencyCode = parentCurrency
      for (const alloc of allocations) {
        if (alloc.currencyCode && alloc.currencyCode !== parentCurrency) {
          throw new BadRequestException(
            `Allocations deben usar la misma moneda que el movimiento (${parentCurrency})`,
          );
        }
      }

      const totalAmount = allocations.reduce((sum, a) => sum + (a.amountMinor ?? 0), 0);
      if (totalAmount !== parentAmount) {
        throw new BadRequestException(
          `Los montos deben sumar exactamente ${parentAmount}, sumaron: ${totalAmount}`,
        );
      }
    } else {
      throw new BadRequestException(
        'Cada allocation debe tener percentage o amountMinor',
      );
    }

    // Validar no hay duplicados por buildingId
    const buildingIdSet = new Set(buildingIds);
    if (buildingIdSet.size !== buildingIds.length) {
      throw new BadRequestException(
        'No puedes tener múltiples allocations para el mismo buildingId',
      );
    }
  }

  /**
   * Crea allocations para un expense TENANT_SHARED
   */
  async createForExpense(
    tenantId: string,
    expenseId: string,
    amountMinor: number,
    currencyCode: string,
    allocations: CreateAllocationInput[],
    membershipId: string,
  ): Promise<void> {
    await this.validateAllocations(tenantId, allocations, amountMinor, currencyCode);

    // Crear allocations
    for (const alloc of allocations) {
      const resolvedAmount = alloc.percentage
        ? Math.floor((amountMinor * (alloc.percentage / 100)))
        : alloc.amountMinor!;

      await this.prisma.movementAllocation.create({
        data: {
          tenantId,
          expenseId,
          buildingId: alloc.buildingId,
          percentage: alloc.percentage ?? null,
          amountMinor: resolvedAmount,
          currencyCode,
        },
      });
    }

    // Audit
    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'EXPENSE_ALLOCATION_CREATE',
      entityType: 'MovementAllocation',
      entityId: expenseId,
      metadata: { allocationCount: allocations.length, totalAmount: amountMinor },
    });
  }

  /**
   * Crea allocations para un income TENANT_SHARED
   */
  async createForIncome(
    tenantId: string,
    incomeId: string,
    amountMinor: number,
    currencyCode: string,
    allocations: CreateAllocationInput[],
    membershipId: string,
  ): Promise<void> {
    await this.validateAllocations(tenantId, allocations, amountMinor, currencyCode);

    for (const alloc of allocations) {
      const resolvedAmount = alloc.percentage
        ? Math.floor((amountMinor * (alloc.percentage / 100)))
        : alloc.amountMinor!;

      await this.prisma.movementAllocation.create({
        data: {
          tenantId,
          incomeId,
          buildingId: alloc.buildingId,
          percentage: alloc.percentage ?? null,
          amountMinor: resolvedAmount,
          currencyCode,
        },
      });
    }

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'INCOME_ALLOCATION_CREATE',
      entityType: 'MovementAllocation',
      entityId: incomeId,
      metadata: { allocationCount: allocations.length, totalAmount: amountMinor },
    });
  }

  /**
   * Obtiene allocations de un expense/income
   */
  async getAllocations(
    tenantId: string,
    expenseId?: string,
    incomeId?: string,
  ): Promise<any[]> {
    return this.prisma.movementAllocation.findMany({
      where: {
        tenantId,
        ...(expenseId && { expenseId }),
        ...(incomeId && { incomeId }),
      },
      include: { building: { select: { id: true, name: true } } },
    });
  }

  /**
   * Borra todas las allocations de un movimiento
   */
  async deleteForMovement(tenantId: string, expenseId?: string, incomeId?: string): Promise<void> {
    await this.prisma.movementAllocation.deleteMany({
      where: {
        tenantId,
        ...(expenseId && { expenseId }),
        ...(incomeId && { incomeId }),
      },
    });
  }
}
