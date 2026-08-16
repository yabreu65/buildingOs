import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FundStatus,
  FundType,
  IncomeApplicationDestination,
  IncomeDestination,
  IncomeStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { IncomeApplicationsService } from './income-applications.service';
import { acquireIncomeLock } from './fund-locks';

/**
 * FIN-04: compatibilidad de Income.destination legacy → IncomeApplication.
 *
 * Principios:
 * - IncomeApplications existentes son AUTORITATIVAS; destination queda como metadata.
 * - APPLY_TO_EXPENSES puede materializarse como 100% OFFSET_EXPENSES real.
 * - RESERVE_FUND / SPECIAL_FUND requieren fundId explícito (type validado).
 * - Nunca un OFFSET sintético en memoria: la Liquidación consume rows reales.
 * - Historical safety: no materializar si una liquidation no-cancelada relevante
 *   del mismo período ya existe (el snapshot se habría congelado sin el income).
 */

export type LegacyBackfillClassification =
  | 'AUTO_MAPPABLE_OFFSET'
  | 'REQUIRES_RESERVE_FUND'
  | 'REQUIRES_SPECIAL_FUND'
  | 'ALREADY_HAS_PLAN'
  | 'NOT_RECORDED'
  | 'LIQUIDATION_CONFLICT';

export type LegacyBackfillItemStatus =
  | 'MIGRATED'
  | 'ALREADY_MIGRATED'
  | 'ALREADY_HAS_PLAN'
  | 'REQUIRES_FUND'
  | 'INVALID_FUND'
  | 'LIQUIDATION_CONFLICT'
  | 'NOT_RECORDED'
  | 'NOT_FOUND'
  | 'INVALID_INCOME';

export const LEGACY_BACKFILL_LIQUIDATION_CONFLICT = 'LEGACY_INCOME_BACKFILL_LIQUIDATION_CONFLICT';

const MAX_BACKFILL_BATCH = 100;

interface BackfillCandidate {
  income: {
    id: string;
    tenantId: string;
    buildingId: string | null;
    period: string;
    scopeType: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';
    status: 'DRAFT' | 'RECORDED' | 'VOID';
    destination: IncomeDestination;
    amountMinor: number;
    currencyCode: string;
    receivedDate: Date;
    categoryId: string;
  };
  applicationsCount: number;
}

export interface LegacyBackfillPreviewItem {
  incomeId: string;
  period: string;
  categoryId: string;
  scopeType: string;
  buildingId: string | null;
  status: string;
  destination: IncomeDestination;
  amountMinor: number;
  currencyCode: string;
  applicationsCount: number;
  classification: LegacyBackfillClassification;
  relevantBuildings?: string[];
}

@Injectable()
export class LegacyIncomeBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
    private readonly applicationsService: IncomeApplicationsService,
  ) {}

  private assertAdmin(roles: string[], action: string): void {
    if (!this.validators.isAdminOrOperator(roles)) {
      throw new ForbiddenException(`Solo administradores pueden ${action}`);
    }
  }

  /**
   * Detección de conflictos históricos: si existe una liquidation no-cancelada
   * (DRAFT/REVIEWED/PUBLISHED) para un building/period relevante del income,
   * la materialización se bloquea (el snapshot previo quedó sin el offset).
   */
  private async hasRelevantLiquidationConflict(
    tx: Prisma.TransactionClient,
    tenantId: string,
    income: BackfillCandidate['income'],
  ): Promise<{ conflicted: boolean; buildingIds: string[] }> {
    const relevantBuildings: string[] = [];

    if (income.scopeType === 'BUILDING') {
      if (income.buildingId) {
        relevantBuildings.push(income.buildingId);
      }
    } else {
      // TENANT_SHARED / UNIT_GROUP: usar MovementAllocation persistida.
      const allocations = await tx.movementAllocation.findMany({
        where: { tenantId, incomeId: income.id },
        select: { buildingId: true },
      });
      relevantBuildings.push(...allocations.map((allocation) => allocation.buildingId));
    }

    if (relevantBuildings.length === 0) {
      return { conflicted: false, buildingIds: [] };
    }

    const conflictedLiquidations = await tx.liquidation.findMany({
      where: {
        tenantId,
        period: income.period,
        buildingId: { in: relevantBuildings },
        status: { in: ['DRAFT', 'REVIEWED', 'PUBLISHED'] },
      },
      select: { buildingId: true, status: true },
    });

    return {
      conflicted: conflictedLiquidations.length > 0,
      buildingIds: relevantBuildings,
    };
  }

  private async loadCandidates(
    tx: Prisma.TransactionClient,
    tenantId: string,
    filters: { period?: string; categoryId?: string; destination?: IncomeDestination },
  ): Promise<BackfillCandidate[]> {
    const incomes = await tx.income.findMany({
      where: {
        tenantId,
        ...(filters.period ? { period: filters.period } : {}),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.destination ? { destination: filters.destination } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        buildingId: true,
        period: true,
        scopeType: true,
        status: true,
        destination: true,
        amountMinor: true,
        currencyCode: true,
        receivedDate: true,
        categoryId: true,
      },
    });

    const applicationCounts = await tx.incomeApplication.groupBy({
      by: ['incomeId'],
      where: { tenantId },
      _count: { _all: true },
    });
    const countByIncome = new Map(
      applicationCounts.map((row) => [row.incomeId, row._count._all]),
    );

    return incomes.map((income) => ({
      income: income as BackfillCandidate['income'],
      applicationsCount: countByIncome.get(income.id) ?? 0,
    }));
  }

  private async classify(
    tx: Prisma.TransactionClient,
    tenantId: string,
    candidate: BackfillCandidate,
  ): Promise<LegacyBackfillClassification> {
    const { income, applicationsCount } = candidate;

    if (income.status !== 'RECORDED') {
      return 'NOT_RECORDED';
    }
    if (applicationsCount > 0) {
      return 'ALREADY_HAS_PLAN';
    }
    if (income.destination === 'RESERVE_FUND') {
      return 'REQUIRES_RESERVE_FUND';
    }
    if (income.destination === 'SPECIAL_FUND') {
      return 'REQUIRES_SPECIAL_FUND';
    }
    // APPLY_TO_EXPENSES
    const conflict = await this.hasRelevantLiquidationConflict(tx, tenantId, income);
    if (conflict.conflicted) {
      return 'LIQUIDATION_CONFLICT';
    }
    return 'AUTO_MAPPABLE_OFFSET';
  }

  /**
   * Preview: no escribe. Devuelve candidatos legacy con clasificación.
   */
  async preview(
    tenantId: string,
    membershipId: string,
    roles: string[],
    filters: { period?: string; categoryId?: string; destination?: IncomeDestination },
  ): Promise<LegacyBackfillPreviewItem[]> {
    this.assertAdmin(roles, 'previsualizar backfill de ingresos legacy');
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException('No se encontró una membresía válida para el tenant');
    }

    const candidates = await this.loadCandidates(this.prisma, tenantId, filters);
    const result: LegacyBackfillPreviewItem[] = [];

    for (const candidate of candidates) {
      const { income, applicationsCount } = candidate;
      const classification = await this.classify(this.prisma, tenantId, candidate);
      const conflict = await this.hasRelevantLiquidationConflict(this.prisma, tenantId, income);

      result.push({
        incomeId: income.id,
        period: income.period,
        categoryId: income.categoryId,
        scopeType: income.scopeType,
        buildingId: income.buildingId,
        status: income.status,
        destination: income.destination,
        amountMinor: income.amountMinor,
        currencyCode: income.currencyCode,
        applicationsCount,
        classification,
        ...(conflict.buildingIds.length > 0
          ? { relevantBuildings: conflict.buildingIds }
          : {}),
      });
    }

    return result;
  }

  /**
   * Apply: transacción POR INCOME (idempotente, restartable). Cada item
   * retorna un status; un error no pierde los ya migrados.
   */
  async apply(
    tenantId: string,
    membershipId: string,
    roles: string[],
    items: Array<{ incomeId: string; fundId?: string | null }>,
  ): Promise<Array<{ incomeId: string; status: LegacyBackfillItemStatus; fundId?: string | null }>> {
    this.assertAdmin(roles, 'ejecutar backfill de ingresos legacy');

    if (items.length === 0) {
      throw new BadRequestException('El lote de backfill está vacío');
    }
    if (items.length > MAX_BACKFILL_BATCH) {
      throw new BadRequestException(
        `El lote máximo es ${MAX_BACKFILL_BATCH} items (recibido: ${items.length})`,
      );
    }

    // Orden determinístico por incomeId.
    const sortedItems = [...items].sort((a, b) => a.incomeId.localeCompare(b.incomeId));
    const results: Array<{ incomeId: string; status: LegacyBackfillItemStatus; fundId?: string | null }> = [];

    for (const item of sortedItems) {
      results.push(
        await this.applySingle(tenantId, membershipId, item.incomeId, item.fundId ?? null),
      );
    }

    return results;
  }

  private async applySingle(
    tenantId: string,
    membershipId: string,
    incomeId: string,
    fundId: string | null,
  ): Promise<{ incomeId: string; status: LegacyBackfillItemStatus; fundId?: string | null }> {
    return this.prisma.$transaction(async (tx) => {
      await acquireIncomeLock(tx, tenantId, incomeId);

      const income = await tx.income.findFirst({
        where: { id: incomeId, tenantId },
      });
      if (!income) {
        return { incomeId, status: 'NOT_FOUND' };
      }
      if (income.status !== IncomeStatus.RECORDED) {
        return { incomeId, status: 'NOT_RECORDED' };
      }

      const existingApplications = await tx.incomeApplication.count({
        where: { tenantId, incomeId },
      });
      if (existingApplications > 0) {
        // Idempotencia: si el plan existente fue creado por legacy → ALREADY_MIGRATED.
        const legacyApp = await tx.incomeApplication.findFirst({
          where: { tenantId, incomeId, legacyDestination: { not: null } },
          select: { id: true },
        });
        return {
          incomeId,
          status: legacyApp ? 'ALREADY_MIGRATED' : 'ALREADY_HAS_PLAN',
        };
      }

      const destination = income.destination;
      let plan: Array<{
        destinationType: IncomeApplicationDestination;
        fundId: string | null;
        amountMinor: number;
      }>;

      if (destination === 'APPLY_TO_EXPENSES') {
        const conflict = await this.hasRelevantLiquidationConflict(tx, tenantId, income);
        if (conflict.conflicted) {
          return { incomeId, status: 'LIQUIDATION_CONFLICT' };
        }
        plan = [
          {
            destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
            fundId: null,
            amountMinor: income.amountMinor,
          },
        ];
      } else if (destination === 'RESERVE_FUND' || destination === 'SPECIAL_FUND') {
        if (!fundId) {
          return { incomeId, status: 'REQUIRES_FUND' };
        }
        const expectedType = destination === 'RESERVE_FUND' ? FundType.RESERVE : FundType.SPECIAL;
        const fund = await tx.fund.findFirst({
          where: { id: fundId, tenantId },
          select: { id: true, status: true, type: true },
        });
        if (!fund) {
          return { incomeId, status: 'INVALID_FUND' };
        }
        if (fund.status !== FundStatus.ACTIVE) {
          return { incomeId, status: 'INVALID_FUND' };
        }
        if (fund.type !== expectedType) {
          return { incomeId, status: 'INVALID_FUND' };
        }
        plan = [
          {
            destinationType: IncomeApplicationDestination.FUND,
            fundId: fund.id,
            amountMinor: income.amountMinor,
          },
        ];
      } else {
        return { incomeId, status: 'INVALID_INCOME' };
      }

      // Publicar mediante el publisher FIN-03 compartido (aplicación real + CREDIT).
      const published = await this.applicationsService.publishLegacyBackfillPlan(tx, {
        tenantId,
        incomeId,
        membershipId,
        legacyDestination: destination,
        plan,
        fundTransactionOccurredAt: income.receivedDate,
      });

      await this.auditService.createLogRequired(
        {
          tenantId,
          actorMembershipId: membershipId,
          action: 'INCOME_LEGACY_BACKFILL',
          entityType: 'Income',
          entityId: incomeId,
          metadata: {
            incomeId,
            legacyDestination: destination,
            applicationId: published.applications[0]?.id ?? null,
            destinationType: published.applications[0]?.destinationType ?? null,
            amountMinor: income.amountMinor,
            currencyCode: income.currencyCode,
            mode: 'EXPLICIT_BACKFILL',
            ...(destination !== 'APPLY_TO_EXPENSES' && fundId ? { fundId } : {}),
            incomeReceivedDate: income.receivedDate.toISOString(),
            period: income.period,
          },
        },
        tx,
      );

      return { incomeId, status: 'MIGRATED', fundId: fundId ?? undefined };
    });
  }

  /**
   * Auto-materialización para Liquidation (createDraft): materializa incomes
   * legacy APPLY_TO_EXPENSES sin applications dentro de la MISMA transacción.
   * Los conflictos históricos bloquean; si createDraft falla después, todo
   * (application + audits) hace rollback con la tx.
   */
  async materializeForLiquidation(params: {
    tx: Prisma.TransactionClient;
    tenantId: string;
    buildingId: string;
    period: string;
    membershipId: string;
  }): Promise<void> {
    const { tx, tenantId, buildingId, period, membershipId } = params;

    const candidates = await this.loadCandidates(tx, tenantId, {
      period,
      destination: 'APPLY_TO_EXPENSES' as IncomeDestination,
    });

    for (const candidate of candidates) {
      const { income, applicationsCount } = candidate;
      if (income.status !== IncomeStatus.RECORDED || applicationsCount > 0) {
        continue; // applications existentes son autoritativas
      }

      // Income lock en orden determinístico (race void/plan vs lazy).
      await acquireIncomeLock(tx, tenantId, income.id);

      // Reload post-lock: estado fresco.
      const reloaded = await tx.income.findFirst({
        where: { id: income.id, tenantId, status: IncomeStatus.RECORDED },
      });
      if (!reloaded) {
        continue; // void ganó la carrera
      }
      // Defensivo: solo se auto-materializa APPLY_TO_EXPENSES (el filtro de la
      // query ya lo restringe; esto protege contra cualquier desviación).
      if (reloaded.destination !== IncomeDestination.APPLY_TO_EXPENSES) {
        continue; // RESERVE/SPECIAL nunca se auto-materializan
      }
      const reloadedCount = await tx.incomeApplication.count({
        where: { tenantId, incomeId: income.id },
      });
      if (reloadedCount > 0) {
        continue; // plan concurrente ganó → autoritativo
      }

      const conflict = await this.hasRelevantLiquidationConflict(tx, tenantId, reloaded);
      if (conflict.conflicted) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: LEGACY_BACKFILL_LIQUIDATION_CONFLICT,
          message:
            `El ingreso legacy ${income.id} tiene un conflicto histórico de liquidación ` +
            `(${income.period}); no se materializa su OFFSET automáticamente`,
        });
      }

      await this.applicationsService.publishLegacyBackfillPlan(tx, {
        tenantId,
        incomeId: income.id,
        membershipId,
        legacyDestination: IncomeDestination.APPLY_TO_EXPENSES,
        plan: [
          {
            destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
            fundId: null,
            amountMinor: reloaded.amountMinor,
          },
        ],
      });

      await this.auditService.createLogRequired(
        {
          tenantId,
          actorMembershipId: membershipId,
          action: 'INCOME_LEGACY_BACKFILL',
          entityType: 'Income',
          entityId: income.id,
          metadata: {
            incomeId: income.id,
            legacyDestination: 'APPLY_TO_EXPENSES',
            destinationType: 'OFFSET_EXPENSES',
            amountMinor: reloaded.amountMinor,
            currencyCode: reloaded.currencyCode,
            mode: 'LIQUIDATION_AUTO_MATERIALIZE',
            incomeReceivedDate: reloaded.receivedDate.toISOString(),
            triggerBuildingId: buildingId,
            period: income.period,
          },
        },
        tx,
      );
    }
  }
}
