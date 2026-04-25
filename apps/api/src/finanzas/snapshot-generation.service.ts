import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  UnitBalanceMonthlySnapshot,
  BuildingBalanceMonthlySnapshot,
  Prisma,
} from '@prisma/client';

export type SnapshotPeriod = string; // YYYY-MM

export interface GenerateSnapshotOptions {
  tenantId: string;
  buildingId?: string;
  period: SnapshotPeriod;
  recompute?: boolean;
}

export interface BackfillRangeOptions {
  tenantId: string;
  buildingId?: string;
  fromPeriod: SnapshotPeriod;
  toPeriod: SnapshotPeriod;
}

export interface SnapshotGenerationResult {
  unitSnapshotsCreated: number;
  buildingSnapshotsCreated: number;
  period: SnapshotPeriod;
  durationMs: number;
}

export interface BackfillResult {
  periodsProcessed: number;
  totalUnitSnapshots: number;
  totalBuildingSnapshots: number;
  durationMs: number;
  details: Array<{
    period: SnapshotPeriod;
    unitSnapshots: number;
    buildingSnapshots: number;
  }>;
}

@Injectable()
export class SnapshotGenerationService {
  private readonly logger = new Logger(SnapshotGenerationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate period string (YYYY-MM) from a given date
   */
  private getPeriodFromDate(date: Date): SnapshotPeriod {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  /**
   * Get the previous period (YYYY-MM) relative to current or given date
   */
  getPreviousPeriod(fromDate?: Date): SnapshotPeriod {
    const date = fromDate ? new Date(fromDate) : new Date();
    date.setMonth(date.getMonth() - 1);
    return this.getPeriodFromDate(date);
  }

  /**
   * Get asOf timestamp (end of month) for a period in UTC
   */
  private getAsOfForPeriod(period: SnapshotPeriod): Date {
    const parts = period.split('-');
    const yearStr = parts[0] ?? '';
    const monthStr = parts[1] ?? '';
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const asOf = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return asOf;
  }

  /**
   * Generate snapshots for a specific period and tenant
   * - Idempotent: upsert by unique key
   * - Process building by building for memory efficiency
   */
  async generateSnapshots(options: GenerateSnapshotOptions): Promise<SnapshotGenerationResult> {
    const startTime = Date.now();
    const { tenantId, buildingId, period, recompute = false } = options;

    this.logger.log(`Generating snapshots for tenant=${tenantId}, period=${period}, recompute=${recompute}`);

    const asOf = this.getAsOfForPeriod(period);

    // Get all buildings for tenant (or specific building)
    const buildings = await this.prisma.building.findMany({
      where: {
        tenantId,
        ...(buildingId ? { id: buildingId } : {}),
      },
      select: { id: true, name: true },
    });

    let totalUnitSnapshots = 0;
    let totalBuildingSnapshots = 0;

    // Process each building
    for (const building of buildings) {
      const result = await this.generateBuildingSnapshots({
        tenantId,
        buildingId: building.id,
        period,
        asOf,
        recompute,
      });
      totalUnitSnapshots += result.unitSnapshots;
      totalBuildingSnapshots += result.buildingSnapshots;
    }

    const durationMs = Date.now() - startTime;
    this.logger.log(
      `Generated ${totalUnitSnapshots} unit + ${totalBuildingSnapshots} building snapshots in ${durationMs}ms`,
    );

    return {
      unitSnapshotsCreated: totalUnitSnapshots,
      buildingSnapshotsCreated: totalBuildingSnapshots,
      period,
      durationMs,
    };
  }

  /**
   * Generate snapshots for a single building
   */
  private async generateBuildingSnapshots(options: {
    tenantId: string;
    buildingId: string;
    period: SnapshotPeriod;
    asOf: Date;
    recompute: boolean;
  }): Promise<{ unitSnapshots: number; buildingSnapshots: number }> {
    const { tenantId, buildingId, period, asOf, recompute } = options;

    // Get all units in building
    const units = await this.prisma.unit.findMany({
      where: { buildingId },
      select: { id: true },
    });

    let unitSnapshots = 0;
    let totalCharged = 0;
    let totalCollected = 0;
    let totalOverdue = 0;

    // Process each unit
    for (const unit of units) {
      const unitSnapshot = await this.generateUnitSnapshot({
        tenantId,
        buildingId,
        unitId: unit.id,
        period,
        asOf,
        recompute,
      });
      if (unitSnapshot) {
        unitSnapshots++;
        totalCharged += unitSnapshot.chargedMinor;
        totalCollected += unitSnapshot.collectedMinor;
        totalOverdue += unitSnapshot.overdueMinor || 0;
      }
    }

    // Generate building-level snapshot
    await this.generateBuildingSnapshot({
      tenantId,
      buildingId,
      period,
      asOf,
      unitCount: units.length,
      totalCharged,
      totalCollected,
      totalOverdue,
      recompute,
    });

    return {
      unitSnapshots,
      buildingSnapshots: unitSnapshots > 0 ? 1 : 0,
    };
  }

  /**
   * Generate unit snapshot (idempotent upsert)
   */
  private async generateUnitSnapshot(options: {
    tenantId: string;
    buildingId: string;
    unitId: string;
    period: SnapshotPeriod;
    asOf: Date;
    recompute: boolean;
  }): Promise<UnitBalanceMonthlySnapshot | null> {
    const { tenantId, buildingId, unitId, period, asOf, recompute } = options;

    // Get charges for this unit/period
    const charges = await this.prisma.charge.findMany({
      where: {
        tenantId,
        buildingId,
        unitId,
        period,
        status: { not: 'CANCELED' },
      },
      select: { id: true, amount: true },
    });

    if (charges.length === 0) {
      return null;
    }

    const chargedMinor = charges.reduce((sum, c) => sum + Number(c.amount), 0);

    // Get collected: sum of allocations for these charges
    const chargeIds = charges.map((c) => c.id);
    const allocations = await this.prisma.paymentAllocation.aggregate({
      where: { chargeId: { in: chargeIds } },
      _sum: { amount: true },
    });

    const collectedMinor = Number(allocations._sum.amount || 0);
    const outstandingMinor = chargedMinor - collectedMinor;

    // Get overdue: charges with dueDate < asOf and not fully paid
    const overdueCharges = await this.prisma.charge.findMany({
      where: {
        id: { in: chargeIds },
        dueDate: { lt: asOf },
        status: { not: 'PAID' },
      },
      select: { amount: true },
    });

    const overdueMinor = overdueCharges.reduce((sum, c) => sum + Number(c.amount), 0);

    // Collection rate in basis points
    const collectionRateBp =
      chargedMinor > 0
        ? Math.round((collectedMinor / chargedMinor) * 10000)
        : null;

    // Upsert (idempotent)
    const data: Prisma.UnitBalanceMonthlySnapshotUpsertArgs['create'] = {
      tenantId,
      buildingId,
      unitId,
      period,
      asOf,
      currency: 'ARS',
      chargedMinor,
      collectedMinor,
      outstandingMinor,
      overdueMinor,
      collectionRateBp,
      snapshotVersion: 'p2a-v1',
      generatedAt: new Date(),
    };

    try {
      return await this.prisma.unitBalanceMonthlySnapshot.upsert({
        where: {
          tenantId_unitId_period_currency: { tenantId, unitId, period, currency: 'ARS' },
        },
        create: data,
        update: recompute
          ? { ...data, recomputedAt: new Date() }
          : { chargedMinor, collectedMinor, outstandingMinor, overdueMinor, collectionRateBp },
      });
    } catch (error) {
      this.logger.error(
        `Failed to upsert unit snapshot for unit=${unitId}, period=${period}`,
        error instanceof Error ? error.stack : '',
      );
      return null;
    }
  }

  /**
   * Generate building-level snapshot (idempotent upsert)
   */
  private async generateBuildingSnapshot(options: {
    tenantId: string;
    buildingId: string;
    period: SnapshotPeriod;
    asOf: Date;
    unitCount: number;
    totalCharged: number;
    totalCollected: number;
    totalOverdue: number;
    recompute: boolean;
  }): Promise<BuildingBalanceMonthlySnapshot | null> {
    const { tenantId, buildingId, period, asOf, unitCount, totalCharged, totalCollected, totalOverdue, recompute } = options;

    const outstandingMinor = totalCharged - totalCollected;
    const collectionRateBp =
      totalCharged > 0
        ? Math.round((totalCollected / totalCharged) * 10000)
        : null;

    const data: Prisma.BuildingBalanceMonthlySnapshotUpsertArgs['create'] = {
      tenantId,
      buildingId,
      period,
      asOf,
      currency: 'ARS',
      unitCount,
      chargedMinor: totalCharged,
      collectedMinor: totalCollected,
      outstandingMinor,
      overdueMinor: totalOverdue,
      collectionRateBp,
      snapshotVersion: 'p2a-v1',
      generatedAt: new Date(),
    };

    try {
      return await this.prisma.buildingBalanceMonthlySnapshot.upsert({
        where: {
          tenantId_buildingId_period_currency: {
            tenantId,
            buildingId,
            period,
            currency: 'ARS',
          },
        },
        create: data,
        update: recompute
          ? { ...data, recomputedAt: new Date() }
          : {
              unitCount,
              chargedMinor: totalCharged,
              collectedMinor: totalCollected,
              outstandingMinor,
              overdueMinor: totalOverdue,
              collectionRateBp,
            },
      });
    } catch (error) {
      this.logger.error(
        `Failed to upsert building snapshot for building=${buildingId}, period=${period}`,
        error instanceof Error ? error.stack : '',
      );
      return null;
    }
  }

  /**
   * Backfill range of periods
   */
  async backfillRange(options: BackfillRangeOptions): Promise<BackfillResult> {
    const startTime = Date.now();
    const { tenantId, buildingId, fromPeriod, toPeriod } = options;

    this.logger.log(
      `Backfilling snapshots for tenant=${tenantId}, from=${fromPeriod}, to=${toPeriod}`,
    );

    // Generate list of periods
    const periods: SnapshotPeriod[] = [];
    let current = fromPeriod;
    while (current <= toPeriod) {
      periods.push(current);
      const parts = current.split('-');
      const yearStr = parts[0] ?? '';
      const monthStr = parts[1] ?? '';
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      current = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
    }

    const details: BackfillResult['details'] = [];
    let totalUnitSnapshots = 0;
    let totalBuildingSnapshots = 0;

    for (const period of periods) {
      const result = await this.generateSnapshots({
        tenantId,
        buildingId,
        period,
        recompute: true,
      });
      details.push({
        period,
        unitSnapshots: result.unitSnapshotsCreated,
        buildingSnapshots: result.buildingSnapshotsCreated,
      });
      totalUnitSnapshots += result.unitSnapshotsCreated;
      totalBuildingSnapshots += result.buildingSnapshotsCreated;
    }

    const durationMs = Date.now() - startTime;
    this.logger.log(
      `Backfill complete: ${periods.length} periods, ${totalUnitSnapshots} unit + ${totalBuildingSnapshots} building snapshots in ${durationMs}ms`,
    );

    return {
      periodsProcessed: periods.length,
      totalUnitSnapshots,
      totalBuildingSnapshots,
      durationMs,
      details,
    };
  }

  /**
   * Generate snapshots for previous period (cron helper)
   */
  async generateSnapshotsForPreviousPeriod(tenantId: string): Promise<SnapshotGenerationResult> {
    const period = this.getPreviousPeriod();
    return this.generateSnapshots({ tenantId, period });
  }

  /**
   * Get all active tenants (for cron)
   */
  async getAllActiveTenants() {
    return this.prisma.tenant.findMany({
      select: { id: true },
      orderBy: { name: 'asc' },
    });
  }
}