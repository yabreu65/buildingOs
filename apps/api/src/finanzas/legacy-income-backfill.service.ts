import {
  BadRequestException,
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
  ScopeType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
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
 * - FIN-04R: la materialización lazy es building-targeted (nunca materializa
 *   incomes de otros buildings ni shared con share 0); los income locks se
 *   adquieren en orden determinístico global; el backfill explícito exige
 *   membresía real TENANT-scoped TENANT_OWNER/TENANT_ADMIN.
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

export const MAX_BACKFILL_BATCH = 100;

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
    private readonly applicationsService: IncomeApplicationsService,
  ) {}

  /**
   * FIN-04R RBAC estricto: backfill explícito tenant-wide exige membresía REAL
   * con rol TENANT-scoped TENANT_OWNER o TENANT_ADMIN.
   * OPERATOR / RESIDENT / BUILDING-scoped admin / UNIT-scoped / otro tenant → 403.
   */
  private async assertExplicitBackfillAdminMembership(
    tenantId: string,
    membershipId: string,
  ): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: {
        id: true,
        roles: { select: { role: true, scopeType: true } },
      },
    });

    if (!membership) {
      throw new ForbiddenException('No se encontró una membresía válida para el tenant');
    }

    const allowed = membership.roles.some(
      (role) =>
        role.scopeType === ScopeType.TENANT &&
        (role.role === 'TENANT_OWNER' || role.role === 'TENANT_ADMIN'),
    );

    if (!allowed) {
      throw new ForbiddenException(
        'Solo administradores con rol de tenant pueden ejecutar el backfill de ingresos legacy',
      );
    }
  }

  /**
   * Detección de conflictos históricos: si existe una liquidation no-cancelada
   * (DRAFT/REVIEWED/PUBLISHED) para un building/period relevante del income,
   * la materialización se bloquea (el snapshot previo quedó sin el offset).
   *
   * FIN-04R: para shared, solo allocations con amountMinor > 0 cuentan como
   * relevantes (una allocation 0/NULL no genera conflicto ni relevance).
   */
  private async hasRelevantLiquidationConflict(
    tx: Prisma.TransactionClient,
    tenantId: string,
    income: BackfillCandidate['income'],
    allocations?: ReadonlyArray<{ buildingId: string; amountMinor: number | null }>,
  ): Promise<{ conflicted: boolean; buildingIds: string[] }> {
    const relevantBuildings: string[] = [];

    if (income.scopeType === 'BUILDING') {
      if (income.buildingId) {
        relevantBuildings.push(income.buildingId);
      }
    } else {
      // TENANT_SHARED / UNIT_GROUP: solo allocations con amountMinor > 0.
      const source = allocations ?? (await this.loadAllocations(tx, tenantId, income.id));
      for (const allocation of source) {
        if (allocation.amountMinor !== null && allocation.amountMinor > 0) {
          relevantBuildings.push(allocation.buildingId);
        }
      }
    }

    const uniqueBuildings = [...new Set(relevantBuildings)].sort();
    if (uniqueBuildings.length === 0) {
      return { conflicted: false, buildingIds: [] };
    }

    const conflictedLiquidations = await tx.liquidation.findMany({
      where: {
        tenantId,
        period: income.period,
        buildingId: { in: uniqueBuildings },
        status: { in: ['DRAFT', 'REVIEWED', 'PUBLISHED'] },
      },
      select: { buildingId: true, status: true },
    });

    return {
      conflicted: conflictedLiquidations.length > 0,
      buildingIds: uniqueBuildings,
    };
  }

  private async loadAllocations(
    tx: Prisma.TransactionClient,
    tenantId: string,
    incomeId: string,
  ): Promise<Array<{ buildingId: string; amountMinor: number | null }>> {
    return tx.movementAllocation.findMany({
      where: { tenantId, incomeId },
      select: { buildingId: true, amountMinor: true },
    });
  }

  private async loadCandidates(
    tx: Prisma.TransactionClient,
    tenantId: string,
    filters: { period?: string; categoryId?: string; destination?: IncomeDestination },
    incomeIds?: string[],
  ): Promise<BackfillCandidate[]> {
    const incomes = await tx.income.findMany({
      where: {
        tenantId,
        ...(incomeIds ? { id: { in: incomeIds } } : {}),
        ...(filters.period ? { period: filters.period } : {}),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.destination ? { destination: filters.destination } : {}),
      },
      orderBy: { id: 'asc' }, // FIN-04R: orden determinístico en discovery
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

    if (incomes.length === 0) {
      return [];
    }

    const ids = incomes.map((income) => income.id);
    const applicationCounts = await tx.incomeApplication.groupBy({
      by: ['incomeId'],
      where: { tenantId, incomeId: { in: ids } }, // FIN-04R: limitar a candidatos
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
    filters: { period?: string; categoryId?: string; destination?: IncomeDestination },
  ): Promise<LegacyBackfillPreviewItem[]> {
    await this.assertExplicitBackfillAdminMembership(tenantId, membershipId);

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
    items: Array<{ incomeId: string; fundId?: string | null }>,
  ): Promise<Array<{ incomeId: string; status: LegacyBackfillItemStatus; fundId?: string | null }>> {
    await this.assertExplicitBackfillAdminMembership(tenantId, membershipId);

    // Defense in depth: nunca items.length TypeError.
    if (!Array.isArray(items) || items === null || items === undefined) {
      throw new BadRequestException('El lote de backfill debe ser un array');
    }
    if (items.length === 0) {
      throw new BadRequestException('El lote de backfill está vacío');
    }
    if (items.length > MAX_BACKFILL_BATCH) {
      throw new BadRequestException(
        `El lote máximo es ${MAX_BACKFILL_BATCH} items (recibido: ${items.length})`,
      );
    }
    for (const item of items) {
      if (!item || typeof item.incomeId !== 'string' || item.incomeId.trim().length === 0) {
        throw new BadRequestException('Cada item de backfill requiere incomeId no vacío');
      }
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

      // FIN-04R: el mapping legacy siempre produce exactamente UNA aplicación.
      const [application] = published.applications;
      if (!application) {
        throw new Error(
          `Legacy backfill invariant violation: se esperaba exactamente 1 aplicación para ${incomeId}`,
        );
      }

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
            applicationId: application.id,
            destinationType: application.destinationType,
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
   *
   * FIN-04R:
   * - Solo candidates RELEVANTES para el building objetivo (BUILDING con el
   *   building exacto; shared con allocation > 0 hacia ese building).
   * - Discovery determinístico (orderBy id) + locks en orden ASC global.
   * - Reload completo post-lock; relevance recalculada post-lock.
   * - Un candidate con share 0 en el building objetivo se SKIP (no materializa).
   */
  async materializeForLiquidation(params: {
    tx: Prisma.TransactionClient;
    tenantId: string;
    buildingId: string;
    period: string;
    membershipId: string;
  }): Promise<void> {
    const { tx, tenantId, buildingId, period, membershipId } = params;

    // 1. Discovery de candidate IDs relevantes para el building objetivo.
    const relevantIncomeIds = await this.discoverRelevantCandidateIds(
      tx,
      tenantId,
      buildingId,
      period,
    );

    if (relevantIncomeIds.length === 0) {
      return;
    }

    // 2. Locks en orden determinístico ASC (evita deadlock por orden variable).
    for (const incomeId of relevantIncomeIds) {
      await acquireIncomeLock(tx, tenantId, incomeId);
    }

    // 3. Reload completo POST-LOCK.
    const candidates = await this.loadCandidates(
      tx,
      tenantId,
      { period, destination: IncomeDestination.APPLY_TO_EXPENSES },
      relevantIncomeIds,
    );

    for (const candidate of candidates) {
      const { income, applicationsCount } = candidate;
      if (income.status !== IncomeStatus.RECORDED || applicationsCount > 0) {
        continue; // applications existentes son autoritativas
      }
      // Defensivo: solo APPLY_TO_EXPENSES se auto-materializa (el discovery ya
      // filtra; esto protege contra cualquier desviación del filtro).
      if (income.destination !== IncomeDestination.APPLY_TO_EXPENSES) {
        continue; // RESERVE/SPECIAL nunca se auto-materializan
      }

      // 4. Relevancia post-lock (nunca stale pre-lock).
      const allocations = await this.loadAllocations(tx, tenantId, income.id);
      const hasPositiveShareInTrigger = this.hasPositiveShareInBuilding(
        income,
        allocations,
        buildingId,
      );
      if (!hasPositiveShareInTrigger) {
        continue; // share 0 en el building objetivo → no materializa
      }

      const conflict = await this.hasRelevantLiquidationConflict(
        tx,
        tenantId,
        income,
        allocations,
      );
      if (conflict.conflicted) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: LEGACY_BACKFILL_LIQUIDATION_CONFLICT,
          message:
            `El ingreso legacy ${income.id} tiene un conflicto histórico de liquidación ` +
            `(${income.period}); no se materializa su OFFSET automáticamente`,
        });
      }

      const published = await this.applicationsService.publishLegacyBackfillPlan(tx, {
        tenantId,
        incomeId: income.id,
        membershipId,
        legacyDestination: IncomeDestination.APPLY_TO_EXPENSES,
        plan: [
          {
            destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
            fundId: null,
            amountMinor: income.amountMinor,
          },
        ],
      });

      // FIN-04R: exactamente una aplicación; audit con applicationId exacto.
      const [application] = published.applications;
      if (!application) {
        throw new Error(
          `Legacy lazy materialization invariant violation: se esperaba 1 aplicación para ${income.id}`,
        );
      }

      await this.auditService.createLogRequired(
        {
          tenantId,
          actorMembershipId: membershipId,
          action: 'INCOME_LEGACY_BACKFILL',
          entityType: 'Income',
          entityId: income.id,
          metadata: {
            incomeId: income.id,
            legacyDestination: IncomeDestination.APPLY_TO_EXPENSES,
            applicationId: application.id,
            destinationType: application.destinationType,
            amountMinor: income.amountMinor,
            currencyCode: income.currencyCode,
            mode: 'LIQUIDATION_AUTO_MATERIALIZE',
            incomeReceivedDate: income.receivedDate.toISOString(),
            triggerBuildingId: buildingId,
            period: income.period,
          },
        },
        tx,
      );
    }
  }

  /**
   * Descubre SOLO incomes legacy APPLY relevantes para el building objetivo:
   * - BUILDING: income.buildingId == trigger building.
   * - TENANT_SHARED / UNIT_GROUP: existe MovementAllocation con amountMinor > 0
   *   hacia el trigger building.
   * Retorna IDs ordenados ASC.
   */
  private async discoverRelevantCandidateIds(
    tx: Prisma.TransactionClient,
    tenantId: string,
    buildingId: string,
    period: string,
  ): Promise<string[]> {
    const incomes = await tx.income.findMany({
      where: {
        tenantId,
        period,
        status: IncomeStatus.RECORDED,
        destination: IncomeDestination.APPLY_TO_EXPENSES,
      },
      orderBy: { id: 'asc' },
      select: { id: true, scopeType: true, buildingId: true },
    });

    const buildingIds = incomes
      .filter((income) => income.scopeType === 'BUILDING' && income.buildingId === buildingId)
      .map((income) => income.id);

    const sharedIds = incomes
      .filter((income) => income.scopeType !== 'BUILDING')
      .map((income) => income.id);

    const relevantSharedIds: string[] = [];
    if (sharedIds.length > 0) {
      const allocations = await tx.movementAllocation.findMany({
        where: {
          tenantId,
          incomeId: { in: sharedIds },
          buildingId,
          amountMinor: { gt: 0 },
        },
        select: { incomeId: true },
      });
      relevantSharedIds.push(
        ...allocations.map((allocation) => allocation.incomeId as string),
      );
    }

    return [...new Set([...buildingIds, ...relevantSharedIds])].sort();
  }

  private hasPositiveShareInBuilding(
    income: BackfillCandidate['income'],
    allocations: ReadonlyArray<{ buildingId: string; amountMinor: number | null }>,
    buildingId: string,
  ): boolean {
    if (income.scopeType === 'BUILDING') {
      return income.buildingId === buildingId;
    }
    return allocations.some(
      (allocation) =>
        allocation.buildingId === buildingId &&
        allocation.amountMinor !== null &&
        allocation.amountMinor > 0,
    );
  }
}
