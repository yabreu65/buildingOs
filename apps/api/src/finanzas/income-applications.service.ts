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

      // Plan existente → idempotencia
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
          // Retry del mismo plan: devolver el plan existente, sin nuevas mutaciones.
          return {
            incomeId,
            currencyCode: income.currencyCode,
            totalAmountMinor: totalRequested,
            applications: existing.map((app) => this.toDto(app)),
          };
        }
        throw new ConflictException(
          'Este ingreso ya tiene un plan de aplicaciones diferente',
        );
      }

      // Adquirir locks de Funds en orden determinístico ANTES de validar el
      // estado del fund: evita TOCTOU application vs archive (el archive puede
      // cambiar ACTIVE→ARCHIVED mientras el plan espera el lock).
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
          },
        });

        if (isFund) {
          // El CREDIT del Fund: determinístico por applicationId (retry-safe).
          const transaction = await tx.fundTransaction.create({
            data: {
              tenantId,
              fundId: app.fundId!,
              direction: FundTransactionDirection.CREDIT,
              amountMinor: app.amountMinor,
              currencyCode: income.currencyCode,
              occurredAt: income.receivedDate,
              description: `Aplicación de ingreso ${incomeId}`,
              createdByMembershipId: membershipId,
              idempotencyKey: incomeApplicationFundTransactionKey(application.id),
              incomeApplicationId: application.id,
            },
          });

          // FIN-03R (BLOCKER A): cada CREDIT monetario requiere su propio audit
          // FUND_TRANSACTION_CREATE dentro de la MISMA transacción. Si falla,
          // rollback total (application + FundTransaction + plan).
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
                occurredAt: income.receivedDate.toISOString(),
                idempotencyKey: incomeApplicationFundTransactionKey(application.id),
                incomeApplicationId: application.id,
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
            totalAmountMinor: totalRequested,
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
        totalAmountMinor: totalRequested,
        applications: created.map((app) => this.toDto(app)),
      };
    });
  }

  // ── Internos ─────────────────────────────────────────────────────────────

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
