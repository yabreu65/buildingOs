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

  /**
   * Sugiere allocations por modo:
   * - BUILDING_TOTAL_M2: proporcional a los m² totales de cada edificio
   * - EQUAL_SHARE: distribución igualitaria entre edificios
   */
  async suggestAllocationsByMode(
    tenantId: string,
    mode: 'BUILDING_TOTAL_M2' | 'EQUAL_SHARE',
  ): Promise<Array<{ buildingId: string; buildingName: string; totalM2: number; percentage: number }>> {
    const buildings = await this.prisma.building.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    });

    if (buildings.length === 0) {
      return [];
    }

    if (mode === 'EQUAL_SHARE') {
      const percentage = Math.floor(10000 / buildings.length) / 100;
      const remainder = 100 - percentage * (buildings.length - 1);
      return buildings.map((b, i) => ({
        buildingId: b.id,
        buildingName: b.name,
        totalM2: 0,
        percentage: i === buildings.length - 1 ? remainder : percentage,
      }));
    }

    // BUILDING_TOTAL_M2: fetch m² for each building
    const buildingsWithM2 = await Promise.all(
      buildings.map(async (b) => {
        const result = await this.prisma.unit.aggregate({
          where: { building: { id: b.id, tenantId }, m2: { not: null } },
          _sum: { m2: true },
        });
        return {
          buildingId: b.id,
          buildingName: b.name,
          totalM2: result._sum.m2 ?? 0,
        };
      })
    );

    const totalM2 = buildingsWithM2.reduce((sum, b) => sum + b.totalM2, 0);

    if (totalM2 === 0) {
      // Fallback to equal share if no m² data
      return this.suggestAllocationsByMode(tenantId, 'EQUAL_SHARE');
    }

    // Calculate percentages with precision (4 decimal places)
    const result: Array<{ buildingId: string; buildingName: string; totalM2: number; percentage: number }> = [];
    let remainingPercentage = 100;

    buildingsWithM2.forEach((buildingItem, i) => {
      let percentage: number;

      if (i === buildingsWithM2.length - 1) {
        percentage = remainingPercentage;
      } else {
        percentage = Math.round((buildingItem.totalM2 / totalM2) * 10000) / 100;
        percentage = Math.min(percentage, remainingPercentage);
        remainingPercentage -= percentage;
      }

      result.push({
        buildingId: buildingItem.buildingId,
        buildingName: buildingItem.buildingName,
        totalM2: buildingItem.totalM2,
        percentage,
      });
    });

    return result;
  }
}
