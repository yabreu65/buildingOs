import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';

export interface CreateAllocationInput {
  buildingId: string;
  percentage?: number;
  amountMinor?: number;
  currencyCode?: string;
}

type AllocationDbClient = PrismaService | Prisma.TransactionClient;
type AllocationMode = 'PERCENTAGE' | 'AMOUNT';

type MovementAllocationWithBuilding = Prisma.MovementAllocationGetPayload<{
  include: {
    building: {
      select: {
        id: true;
        name: true;
      };
    };
  };
}>;

const PERCENTAGE_SCALE = 10_000;
const TOTAL_PERCENTAGE_BASIS_POINTS = 100 * PERCENTAGE_SCALE;

function getHomogeneousAllocationMode(
  allocations: readonly CreateAllocationInput[],
): AllocationMode {
  const modes = allocations.map((allocation, index): AllocationMode => {
    const hasPercentage = allocation.percentage !== null && allocation.percentage !== undefined;
    const hasAmount = allocation.amountMinor !== null && allocation.amountMinor !== undefined;

    if (hasPercentage === hasAmount) {
      throw new BadRequestException(
        `La allocation ${index} debe tener exactamente uno de percentage o amountMinor`,
      );
    }

    return hasPercentage ? 'PERCENTAGE' : 'AMOUNT';
  });

  const mode = modes[0];
  if (!mode || modes.some((allocationMode) => allocationMode !== mode)) {
    throw new BadRequestException(
      'Todas las allocations deben usar el mismo modo: percentage o amountMinor',
    );
  }

  return mode;
}

function requirePositivePersistedAmounts(
  amounts: readonly (number | null | undefined)[],
): number[] {
  const validAmounts: number[] = [];
  for (const amount of amounts) {
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new BadRequestException(
        'Las allocations deben producir importes enteros positivos',
      );
    }
    validAmounts.push(amount);
  }
  return validAmounts;
}

export function toBasisPoints(percentage: number): number {
  return Math.round(percentage * PERCENTAGE_SCALE);
}

export function allocateByLargestRemainder(
  totalAmountMinor: number,
  allocations: CreateAllocationInput[],
): number[] {
  const exactAllocations = allocations.map((allocation, index) => {
    const percentage = allocation.percentage;
    if (percentage === null || percentage === undefined) {
      throw new BadRequestException(
        `La allocation ${index} debe tener percentage para distribuir por porcentaje`,
      );
    }
    const basisPoints = toBasisPoints(percentage);
    const numerator = totalAmountMinor * basisPoints;
    const amountMinor = Math.floor(numerator / TOTAL_PERCENTAGE_BASIS_POINTS);

    return {
      index,
      amountMinor,
      remainder: numerator % TOTAL_PERCENTAGE_BASIS_POINTS,
    };
  });

  const allocatedAmount = exactAllocations.reduce(
    (sum, allocation) => sum + allocation.amountMinor,
    0,
  );
  const missingCents = totalAmountMinor - allocatedAmount;

  exactAllocations
    .slice()
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, missingCents)
    .forEach((allocation) => {
      const targetAllocation = exactAllocations[allocation.index];
      if (targetAllocation) {
        targetAllocation.amountMinor += 1;
      }
    });

  const allocatedAmounts = exactAllocations.map((allocation) => allocation.amountMinor);
  const finalAmount = allocatedAmounts.reduce((sum, amount) => sum + amount, 0);

  if (finalAmount !== totalAmountMinor) {
    throw new BadRequestException(
      `Error de redondeo: las allocations suman ${finalAmount}, esperado ${totalAmountMinor}`,
    );
  }

  return allocatedAmounts;
}

/**
 * Distribuye un total funcional (minor units) entre pesos nominales enteros
 * usando largest remainder con aritmética decimal exacta.
 *
 * Garantiza: SUM(resultado) === totalFunctionalMinor exactamente.
 */
export function allocateFunctionalByLargestRemainder(
  totalFunctionalMinor: number,
  weights: readonly number[],
): number[] {
  if (weights.length === 0) {
    throw new BadRequestException('No hay pesos para distribuir el monto funcional');
  }

  const totalDecimal = new Prisma.Decimal(totalFunctionalMinor);
  const weightDecimals = weights.map((weight) => new Prisma.Decimal(weight ?? 0));
  const totalWeight = weightDecimals.reduce(
    (sum, weight) => sum.add(weight),
    new Prisma.Decimal(0),
  );

  const exactShares = weightDecimals.map((weight, index) => {
    const raw = totalDecimal.mul(weight).div(totalWeight);
    const floor = raw.toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
    return {
      index,
      amountMinor: floor.toNumber(),
      remainder: raw.sub(floor),
    };
  });

  const allocatedAmount = exactShares.reduce(
    (sum, share) => sum + share.amountMinor,
    0,
  );
  const missingCents = totalFunctionalMinor - allocatedAmount;

  if (missingCents < 0 || !Number.isSafeInteger(missingCents)) {
    throw new BadRequestException(
      `Error de redondeo al distribuir el monto funcional ${totalFunctionalMinor}`,
    );
  }

  exactShares
    .slice()
    .sort(
      (a, b) =>
        b.remainder.comparedTo(a.remainder) || a.index - b.index,
    )
    .slice(0, missingCents)
    .forEach((share) => {
      const target = exactShares[share.index];
      if (target) {
        target.amountMinor += 1;
      }
    });

  const allocatedAmounts = exactShares.map((share) => share.amountMinor);
  const finalAmount = allocatedAmounts.reduce((sum, amount) => sum + amount, 0);

  if (finalAmount !== totalFunctionalMinor) {
    throw new BadRequestException(
      `Error de redondeo: las allocations funcionales suman ${finalAmount}, esperado ${totalFunctionalMinor}`,
    );
  }

  return allocatedAmounts;
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

    const buildingIds = allocations.map((a) => a.buildingId);
    const buildingIdSet = new Set(buildingIds);
    if (buildingIdSet.size !== buildingIds.length) {
      throw new BadRequestException(
        'No puedes tener múltiples allocations para el mismo buildingId',
      );
    }

    // Verificar buildingIds
    const buildings = await this.prisma.building.findMany({
      where: {
        id: { in: Array.from(buildingIdSet) },
        tenantId,
      },
    });

    if (buildings.length !== buildingIdSet.size) {
      throw new BadRequestException(
        'Algunos buildingIds no pertenecen al tenant o no existen',
      );
    }

    const allocationMode = getHomogeneousAllocationMode(allocations);

    if (allocationMode === 'PERCENTAGE') {
      const percentages = allocations.map((alloc) => {
        const percentage = alloc.percentage;
        if (
          typeof percentage !== 'number' ||
          !Number.isFinite(percentage) ||
          percentage < 0 ||
          percentage > 100
        ) {
          throw new BadRequestException(
            `Porcentaje inválido para buildingId ${alloc.buildingId}: ${percentage}`,
          );
        }
        return percentage;
      });

      const totalPercentageBasisPoints = percentages.reduce(
        (sum, percentage) => sum + toBasisPoints(percentage),
        0,
      );

      if (totalPercentageBasisPoints !== TOTAL_PERCENTAGE_BASIS_POINTS) {
        throw new BadRequestException(
          `Los porcentajes deben sumar 100%, sumaron: ${totalPercentageBasisPoints / PERCENTAGE_SCALE}%`,
        );
      }
      requirePositivePersistedAmounts(
        allocateByLargestRemainder(parentAmount, allocations),
      );
    } else {
      // Verificar que todas las allocations tengan currencyCode = parentCurrency
      for (const alloc of allocations) {
        if (alloc.currencyCode && alloc.currencyCode !== parentCurrency) {
          throw new BadRequestException(
            `Allocations deben usar la misma moneda que el movimiento (${parentCurrency})`,
          );
        }
      }

      const amounts = allocations.map((allocation) => allocation.amountMinor);
      const validAmounts = requirePositivePersistedAmounts(amounts);
      const totalAmount = validAmounts.reduce((sum, amount) => sum + amount, 0);
      if (totalAmount !== parentAmount) {
        throw new BadRequestException(
          `Los montos deben sumar exactamente ${parentAmount}, sumaron: ${totalAmount}`,
        );
      }
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

    await this.createForMovement(this.prisma, {
      tenantId,
      expenseId,
      amountMinor,
      currencyCode,
      allocations,
    });

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
   * Creates MovementAllocations inside an existing Prisma transaction.
   * Does NOT validate (caller must validate beforehand).
   * Does NOT audit (caller handles audit after commit).
   */
  async createForExpenseInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    expenseId: string,
    amountMinor: number,
    currencyCode: string,
    allocations: CreateAllocationInput[],
  ): Promise<void> {
    await this.createForMovement(tx, {
      tenantId,
      expenseId,
      amountMinor,
      currencyCode,
      allocations,
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

    await this.createForMovement(this.prisma, {
      tenantId,
      incomeId,
      amountMinor,
      currencyCode,
      allocations,
    });

    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: 'INCOME_ALLOCATION_CREATE',
      entityType: 'MovementAllocation',
      entityId: incomeId,
      metadata: { allocationCount: allocations.length, totalAmount: amountMinor },
    });
  }

  /** Persist a fully validated allocation set using the caller's transaction client. */
  async createForIncomeInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    incomeId: string,
    amountMinor: number,
    currencyCode: string,
    allocations: CreateAllocationInput[],
  ): Promise<void> {
    await this.createForMovement(tx, {
      tenantId,
      incomeId,
      amountMinor,
      currencyCode,
      allocations,
    });
  }

  private async createForMovement(
    client: AllocationDbClient,
    input: {
      tenantId: string;
      expenseId?: string;
      incomeId?: string;
      amountMinor: number;
      currencyCode: string;
      allocations: CreateAllocationInput[];
    },
  ): Promise<void> {
    const allocationMode = getHomogeneousAllocationMode(input.allocations);
    const allocatedAmounts = allocationMode === 'PERCENTAGE'
      ? allocateByLargestRemainder(input.amountMinor, input.allocations)
      : input.allocations.map((allocation) => allocation.amountMinor);
    const validAmounts = requirePositivePersistedAmounts(allocatedAmounts);

    await client.movementAllocation.createMany({
      data: input.allocations.map((allocation, index) => ({
        tenantId: input.tenantId,
        expenseId: input.expenseId,
        incomeId: input.incomeId,
        buildingId: allocation.buildingId,
        percentage: allocation.percentage ?? null,
        amountMinor: validAmounts[index],
        currencyCode: input.currencyCode,
      })),
    });
  }

  /**
   * Obtiene allocations de un expense/income
   */
  async getAllocations(
    tenantId: string,
    expenseId?: string,
    incomeId?: string,
  ): Promise<MovementAllocationWithBuilding[]> {
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
