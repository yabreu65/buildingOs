import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FundStatus,
  FundTransactionDirection,
  IncomeApplicationDestination,
  IncomeDestination,
  IncomeStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import {
  acquireFundLock,
  acquireIncomeLock,
} from './fund-locks';
import {
  CreateIncomeApplicationsDto,
  IncomeApplicationPlanResponseDto,
} from './income-applications.dto';

/** Idempotency determinística del CREDIT generado por una aplicación FUND. */
export function incomeApplicationFundTransactionKey(applicationId: string): string {
  return `income-application:${applicationId}`;
}

type ApplicationRow = Prisma.IncomeApplicationGetPayload<Record<string, never>> & {
  fundTransaction: { id: string } | null;
};

/** Identidad canónica de una aplicación: orden-insensible para idempotencia. */
function canonicalKey(app: {
  destinationType: IncomeApplicationDestination;
  fundId: string | null;
  amountMinor: number;
}): string {
  return `${app.destinationType}:${app.fundId ?? ''}:${app.amountMinor}`;
}

@Injectable()
export class IncomeApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
  ) {}

  // ── GET plan ─────────────────────────────────────────────────────────────

  async getPlan(
    tenantId: string,
    incomeId: string,
    userRoles: string[],
  ): Promise<IncomeApplicationPlanResponseDto> {
    this.assertAdminOrOperator(userRoles, 'ver aplicaciones de ingresos');

    const income = await this.prisma.income.findFirst({
      where: { id: incomeId, tenantId },
    });
    if (!income) {
      throw new NotFoundException('Ingreso no encontrado o no pertenece al tenant');
    }

    const applications = await this.loadApplications(tenantId, incomeId);
    return {
      incomeId,
      currencyCode: income.currencyCode,
      totalAmountMinor: applications.reduce((sum, app) => sum + app.amountMinor, 0),
      applications: applications.map((app) => this.toDto(app)),
    };
  }

  // ── POST plan (creación publicada, inmutable, idempotente) ──────────────

  async createPlan(
    tenantId: string,
    incomeId: string,
    membershipId: string,
    userRoles: string[],
    dto: CreateIncomeApplicationsDto,
  ): Promise<IncomeApplicationPlanResponseDto> {
    this.assertAdminOrOperator(userRoles, 'crear aplicaciones de ingresos');

    const plan = dto.applications;

    // Validaciones estáticas del plan (antes de locks)
    for (const app of plan) {
      if (!Number.isInteger(app.amountMinor) || app.amountMinor <= 0) {
        throw new BadRequestException(
          `amountMinor debe ser un entero positivo (recibido: ${app.amountMinor})`,
        );
      }
    }
    this.assertNoDuplicateDestinations(plan);

    const totalRequested = plan.reduce((sum, app) => sum + app.amountMinor, 0);

    return this.prisma.$transaction(async (tx) => {
      // Lock del Income: serializa application vs application y application vs void
      await acquireIncomeLock(tx, tenantId, incomeId);

      const income = await tx.income.findFirst({
        where: { id: incomeId, tenantId },
      });
      if (!income) {
        throw new NotFoundException('Ingreso no encontrado o no pertenece al tenant');
      }
      if (income.status !== IncomeStatus.RECORDED) {
        throw new BadRequestException(
          `Solo se pueden aplicar ingresos RECORDED. Estado actual: ${income.status}`,
        );
      }

      // Suma exacta
      if (totalRequested !== income.amountMinor) {
        throw new BadRequestException(
          `La suma de aplicaciones (${totalRequested}) debe ser exactamente ${income.amountMinor}`,
        );
      }

      // Camino interno compartido (FIN-05): misma publicación que apply-policy.
      return this.publishPlanTx(tx, {
        tenantId,
        income,
        membershipId,
        plan: plan.map((app) => ({
          destinationType: app.destinationType,
          fundId: app.fundId ?? null,
          amountMinor: app.amountMinor,
        })),
        totalAmountMinor: totalRequested,
        policyVersionId: null,
      });
    });
  }

  // ── POST apply-policy (FIN-05) ──────────────────────────────────────────

  async applyPolicy(
    tenantId: string,
    incomeId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<IncomeApplicationPlanResponseDto> {
    this.assertAdminOrOperator(userRoles, 'aplicar política de ingresos');

    return this.prisma.$transaction(async (tx) => {
      await acquireIncomeLock(tx, tenantId, incomeId);

      const income = await tx.income.findFirst({
        where: { id: incomeId, tenantId },
      });
      if (!income) {
        throw new NotFoundException('Ingreso no encontrado o no pertenece al tenant');
      }
      if (income.status !== IncomeStatus.RECORDED) {
        throw new BadRequestException(
          `Solo se pueden aplicar políticas a ingresos RECORDED. Estado actual: ${income.status}`,
        );
      }

      // Resolver la versión ACTIVE de la política de la categoría (tenant-scoped).
      const policy = await tx.incomePolicy.findUnique({
        where: { tenantId_categoryId: { tenantId, categoryId: income.categoryId } },
        include: {
          versions: {
            where: { status: 'ACTIVE' },
            include: { rules: true },
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      });
      if (!policy || policy.versions.length === 0) {
        throw new BadRequestException('No existe una política ACTIVE para la categoría de este ingreso');
      }
      const version = policy.versions[0]!;

      // Convertir reglas (basis points) a montos exactos (largest remainder determinístico).
      const plan = this.allocatePolicyRules(
        income.amountMinor,
        version.rules.map((rule) => ({
          destinationType: rule.destinationType,
          fundId: rule.fundId,
          percentageBasisPoints: rule.percentageBasisPoints,
        })),
      );

      // Camino interno compartido (FIN-05): misma publicación que manual plan,
      // con provenance de la versión de política.
      return this.publishPlanTx(tx, {
        tenantId,
        income,
        membershipId,
        plan,
        totalAmountMinor: income.amountMinor,
        policyVersionId: version.id,
      });
    });
  }

  /**
   * FIN-04: publica un plan de materialización legacy reutilizando el publisher
   * compartido (mismas invariantes: income lock, fund locks, CREDITs, audits,
   * idempotencia). legacyDestination marca la provenance; el CREDIT de Fund usa
   * fundTransactionOccurredAt (= Income.receivedDate para backfill histórico).
   */
  async publishLegacyBackfillPlan(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      incomeId: string;
      membershipId: string;
      legacyDestination: IncomeDestination;
      plan: Array<{ destinationType: IncomeApplicationDestination; fundId: string | null; amountMinor: number }>;
      fundTransactionOccurredAt?: Date;
    },
  ): Promise<IncomeApplicationPlanResponseDto> {
    const income = await tx.income.findFirst({
      where: { id: params.incomeId, tenantId: params.tenantId },
    });
    if (!income) {
      throw new NotFoundException(`Ingreso no encontrado: ${params.incomeId}`);
    }
    const totalAmountMinor = params.plan.reduce((sum, app) => sum + app.amountMinor, 0);
    if (totalAmountMinor !== income.amountMinor) {
      throw new BadRequestException(
        `La suma de aplicaciones (${totalAmountMinor}) debe ser exactamente ${income.amountMinor}`,
      );
    }

    return this.publishPlanTx(tx, {
      tenantId: params.tenantId,
      income: {
        id: income.id,
        amountMinor: income.amountMinor,
        currencyCode: income.currencyCode,
        receivedDate: income.receivedDate,
        categoryId: income.categoryId,
      },
      membershipId: params.membershipId,
      plan: params.plan,
      totalAmountMinor,
      policyVersionId: null,
      legacyDestination: params.legacyDestination,
      fundTransactionOccurredAt: params.fundTransactionOccurredAt ?? income.receivedDate,
    });
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  /**
   * Camino interno compartido (FIN-03/FIN-05): publica un plan de aplicaciones
   * con todas las invariantes (idempotencia, locks de Funds, CREDITs, audits).
   * Usado por createPlan (manual) y applyPolicy (generado por política).
   */
  private async publishPlanTx(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      income: { id: string; amountMinor: number; currencyCode: string; receivedDate: Date; categoryId: string };
      membershipId: string;
      plan: Array<{ destinationType: IncomeApplicationDestination; fundId: string | null; amountMinor: number }>;
      totalAmountMinor: number;
      policyVersionId: string | null;
      legacyDestination?: IncomeDestination | null; // FIN-04
      fundTransactionOccurredAt?: Date; // FIN-04: por defecto income.receivedDate
    },
  ): Promise<IncomeApplicationPlanResponseDto> {
    const { tenantId, income, membershipId, plan, totalAmountMinor, policyVersionId } = params;
    const legacyDestination = params.legacyDestination ?? null;
    const fundTransactionOccurredAt = params.fundTransactionOccurredAt ?? income.receivedDate;
    const incomeId = income.id;

    // Plan existente → idempotencia (mismo canonical → retorna existente)
    const existing = await this.loadApplicationsTx(tx, tenantId, incomeId);
    if (existing.length > 0) {
      const existingPlan = new Set(
        existing.map((app) =>
          canonicalKey({
            destinationType: app.destinationType,
            fundId: app.fundId,
            amountMinor: app.amountMinor,
          }),
        ),
      );
      const requestedPlan = new Set(
        plan.map((app) =>
          canonicalKey({
            destinationType: app.destinationType,
            fundId: app.fundId ?? null,
            amountMinor: app.amountMinor,
          }),
        ),
      );

      const samePlan =
        existingPlan.size === requestedPlan.size &&
        [...requestedPlan].every((key) => existingPlan.has(key));

      if (samePlan) {
        return {
          incomeId,
          currencyCode: income.currencyCode,
          totalAmountMinor: totalAmountMinor,
          applications: existing.map((app) => this.toDto(app)),
        };
      }
      throw new ConflictException(
        'Este ingreso ya tiene un plan de aplicaciones diferente',
      );
    }

    // Adquirir locks de Funds en orden determinístico ANTES de validar el
    // estado del fund: evita TOCTOU application vs archive.
    const fundIds = [...new Set(
      plan
        .filter((app) => app.destinationType === IncomeApplicationDestination.FUND)
        .map((app) => app.fundId as string),
    )].sort();
    for (const fundId of fundIds) {
      await acquireFundLock(tx, tenantId, fundId);
    }

    // Validar funds CON el lock tomado (estado estable).
    const funds = await tx.fund.findMany({
      where: { id: { in: fundIds }, tenantId },
      select: { id: true, status: true },
    });
    const fundById = new Map(funds.map((f) => [f.id, f]));
    for (const fundId of fundIds) {
      const fund = fundById.get(fundId);
      if (!fund) {
        throw new NotFoundException(`Fondo no encontrado o no pertenece al tenant: ${fundId}`);
      }
      if (fund.status !== FundStatus.ACTIVE) {
        throw new BadRequestException(`El fondo está archivado: ${fundId}`);
      }
    }

    // Crear aplicaciones + FundTransactions CREDIT (uno a uno)
    const created: ApplicationRow[] = [];
    for (const app of plan) {
      const isFund = app.destinationType === IncomeApplicationDestination.FUND;
      const application = await tx.incomeApplication.create({
        data: {
          tenantId,
          incomeId,
          destinationType: app.destinationType,
          fundId: isFund ? app.fundId! : null,
          amountMinor: app.amountMinor,
          currencyCode: income.currencyCode,
          createdByMembershipId: membershipId,
          policyVersionId,
          legacyDestination,
        },
      });

      if (isFund) {
        const transaction = await tx.fundTransaction.create({
          data: {
            tenantId,
            fundId: app.fundId!,
            direction: FundTransactionDirection.CREDIT,
            amountMinor: app.amountMinor,
            currencyCode: income.currencyCode,
            occurredAt: fundTransactionOccurredAt,
            description: `Aplicación de ingreso ${incomeId}`,
            createdByMembershipId: membershipId,
            idempotencyKey: incomeApplicationFundTransactionKey(application.id),
            incomeApplicationId: application.id,
          },
        });

        await this.auditService.createLogRequired(
          {
            tenantId,
            actorMembershipId: membershipId,
            action: 'FUND_TRANSACTION_CREATE',
            entityType: 'FundTransaction',
            entityId: transaction.id,
            metadata: {
              fundId: app.fundId!,
              direction: FundTransactionDirection.CREDIT,
              amountMinor: app.amountMinor,
              currencyCode: income.currencyCode,
              occurredAt: fundTransactionOccurredAt.toISOString(),
              idempotencyKey: incomeApplicationFundTransactionKey(application.id),
              incomeApplicationId: application.id,
              ...(policyVersionId !== null ? { policyVersionId } : {}),
            },
          },
          tx,
        );

        created.push({
          ...application,
          fundTransaction: { id: transaction.id },
        });
      } else {
        created.push({ ...application, fundTransaction: null });
      }
    }

    // Audit requerido del plan (atómico con la mutación)
    await this.auditService.createLogRequired(
      {
        tenantId,
        actorMembershipId: membershipId,
        action: 'INCOME_APPLICATIONS_CREATE',
        entityType: 'Income',
        entityId: incomeId,
        metadata: {
          incomeId,
          currencyCode: income.currencyCode,
          totalAmountMinor: totalAmountMinor,
          ...(policyVersionId !== null ? { policyVersionId } : {}),
          ...(legacyDestination !== null ? { legacyDestination } : {}),
          applications: plan.map((app) => ({
            destinationType: app.destinationType,
            ...(app.fundId !== undefined && app.fundId !== null
              ? { fundId: app.fundId }
              : {}),
            amountMinor: app.amountMinor,
          })),
        },
      },
      tx,
    );

    return {
      incomeId,
      currencyCode: income.currencyCode,
      totalAmountMinor: totalAmountMinor,
      applications: created.map((app) => this.toDto(app)),
    };
  }

  /**
   * Convierte reglas (basis points) a montos minor exactos con largest
   * remainder determinístico. Orden estable: destinationType, luego fundId.
   * Rechaza si alguna regla genera 0 minor units (income demasiado pequeño).
   */
  private allocatePolicyRules(
    amountMinor: number,
    rules: Array<{ destinationType: IncomeApplicationDestination; fundId: string | null; percentageBasisPoints: number }>,
  ): Array<{ destinationType: IncomeApplicationDestination; fundId: string | null; amountMinor: number }> {
    // Orden canónico determinístico para tie-breaks estables.
    const ordered = [...rules].sort((a, b) => {
      if (a.destinationType !== b.destinationType) {
        return a.destinationType.localeCompare(b.destinationType);
      }
      return (a.fundId ?? '').localeCompare(b.fundId ?? '');
    });

    const exact = ordered.map((rule) => ({
      rule,
      amount: Math.floor((amountMinor * rule.percentageBasisPoints) / 10000),
      remainder: (amountMinor * rule.percentageBasisPoints) % 10000,
    }));

    const allocated = exact.reduce((sum, item) => sum + item.amount, 0);
    const missing = amountMinor - allocated;

    // Distribuir el remanente (menor a rules.length) por mayor remainder;
    // tie-break por orden canónico (índice en `ordered`). Se muta el ORIGINAL
    // en exact[] (no una copia) para que la suma final sea exacta.
    const byRemainder = exact
      .map((item, index) => ({ index }))
      .sort((a, b) => exact[b.index]!.remainder - exact[a.index]!.remainder || a.index - b.index);

    for (let i = 0; i < missing; i += 1) {
      const target = byRemainder[i];
      if (target) {
        exact[target.index]!.amount += 1;
      }
    }

    const result = exact.map((item) => {
      const rule = item.rule;
      if (item.amount <= 0) {
        throw new BadRequestException(
          'El monto del ingreso es demasiado pequeño para la política: una regla generaría 0 unidades',
        );
      }
      return {
        destinationType: rule.destinationType,
        fundId: rule.fundId,
        amountMinor: item.amount,
      };
    });

    const total = result.reduce((sum, item) => sum + item.amountMinor, 0);
    if (total !== amountMinor) {
      throw new BadRequestException(
        `Error de asignación: la suma generada (${total}) no coincide con ${amountMinor}`,
      );
    }
    return result;
  }

  private assertAdminOrOperator(userRoles: string[], action: string): void {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(`Solo administradores pueden ${action}`);
    }
  }

  /**
   * No permitir dos OFFSET_EXPENSES, dos CARRY_FORWARD ni dos FUND hacia el
   * mismo fundId dentro del mismo Income.
   */
  private assertNoDuplicateDestinations(
    plan: Array<{ destinationType: IncomeApplicationDestination; fundId?: string }>,
  ): void {
    const seenNonFund = new Set<IncomeApplicationDestination>();
    const seenFund = new Set<string>();
    for (const app of plan) {
      if (app.destinationType === IncomeApplicationDestination.FUND) {
        if (app.fundId === undefined || app.fundId === null) {
          throw new BadRequestException('fundId es obligatorio para destinationType FUND');
        }
        if (seenFund.has(app.fundId)) {
          throw new BadRequestException(
            `No puede haber dos aplicaciones FUND hacia el mismo fondo: ${app.fundId}`,
          );
        }
        seenFund.add(app.fundId);
      } else {
        if (app.fundId !== undefined && app.fundId !== null) {
          throw new BadRequestException(
            `fundId no aplica para destinationType ${app.destinationType}`,
          );
        }
        if (seenNonFund.has(app.destinationType)) {
          throw new BadRequestException(
            `No puede haber dos aplicaciones ${app.destinationType} en el mismo ingreso`,
          );
        }
        seenNonFund.add(app.destinationType);
      }
    }
  }

  private async loadApplications(
    tenantId: string,
    incomeId: string,
  ): Promise<ApplicationRow[]> {
    return this.loadApplicationsTx(this.prisma, tenantId, incomeId);
  }

  private async loadApplicationsTx(
    tx: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    incomeId: string,
  ): Promise<ApplicationRow[]> {
    return tx.incomeApplication.findMany({
      where: { tenantId, incomeId },
      include: { fundTransaction: { select: { id: true } } },
      orderBy: [{ destinationType: 'asc' }, { fundId: 'asc' }, { amountMinor: 'asc' }],
    }) as Promise<ApplicationRow[]>;
  }

  private toDto(app: ApplicationRow): {
    id: string;
    tenantId: string;
    incomeId: string;
    destinationType: IncomeApplicationDestination;
    fundId: string | null;
    amountMinor: number;
    currencyCode: string;
    fundTransactionId: string | null;
    createdAt: Date;
  } {
    return {
      id: app.id,
      tenantId: app.tenantId,
      incomeId: app.incomeId,
      destinationType: app.destinationType,
      fundId: app.fundId,
      amountMinor: app.amountMinor,
      currencyCode: app.currencyCode,
      fundTransactionId: app.fundTransaction?.id ?? null,
      createdAt: app.createdAt,
    };
  }
}
