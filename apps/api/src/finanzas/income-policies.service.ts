import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FundStatus,
  IncomeApplicationDestination,
  IncomePolicyVersionStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { acquireFundLock } from './fund-locks';
import {
  CreateIncomePolicyDto,
  CreateIncomePolicyVersionDto,
  IncomePolicyResponseDto,
  IncomePolicyRuleResponseDto,
  IncomePolicyVersionResponseDto,
} from './income-policies.dto';

const INCOME_POLICY_LOCK_TAG = 'buildingos_income_policy_lock_v1';

function incomePolicyLockKey(tenantId: string, categoryId: string): string {
  return `${INCOME_POLICY_LOCK_TAG}:${tenantId}:${categoryId}`;
}

type VersionWithRules = Prisma.IncomePolicyVersionGetPayload<Record<string, never>> & {
  rules: Prisma.IncomePolicyRuleGetPayload<Record<string, never>>[];
};

@Injectable()
export class IncomePoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly validators: FinanzasValidators,
  ) {}

  // ── List / get ──────────────────────────────────────────────────────────

  async listPolicies(
    tenantId: string,
    userRoles: string[],
  ): Promise<IncomePolicyResponseDto[]> {
    this.assertAdminOrOperator(userRoles, 'ver políticas de ingresos');

    const policies = await this.prisma.incomePolicy.findMany({
      where: { tenantId },
      include: {
        versions: {
          include: { rules: true },
          orderBy: { version: 'desc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return policies.map((policy) => this.toPolicyDto(policy));
  }

  async getPolicy(
    tenantId: string,
    categoryId: string,
    userRoles: string[],
  ): Promise<IncomePolicyResponseDto> {
    this.assertAdminOrOperator(userRoles, 'ver políticas de ingresos');

    const policy = await this.prisma.incomePolicy.findUnique({
      where: { tenantId_categoryId: { tenantId, categoryId } },
      include: {
        versions: {
          include: { rules: true },
          orderBy: { version: 'desc' },
        },
      },
    });
    if (!policy) {
      throw new NotFoundException('No existe política para esta categoría en el tenant');
    }
    return this.toPolicyDto(policy);
  }

  // ── Create policy with initial version ──────────────────────────────────

  async createPolicy(
    tenantId: string,
    membershipId: string,
    userRoles: string[],
    dto: CreateIncomePolicyDto,
  ): Promise<IncomePolicyResponseDto> {
    this.assertAdminOrOperator(userRoles, 'crear políticas de ingresos');

    const category = await this.assertIncomeCategory(tenantId, dto.categoryId);
    this.assertValidRules(dto.rules);

    return this.prisma.$transaction(async (tx) => {
      // Lock por tenant+category: serializa creación/versiones concurrentes.
      await this.acquirePolicyLock(tx, tenantId, dto.categoryId);

      const existing = await tx.incomePolicy.findUnique({
        where: { tenantId_categoryId: { tenantId, categoryId: dto.categoryId } },
      });
      if (existing) {
        throw new ConflictException('Ya existe una política para esta categoría');
      }

      const policy = await tx.incomePolicy.create({
        data: {
          tenantId,
          categoryId: dto.categoryId,
          createdByMembershipId: membershipId,
        },
      });

      const version = await this.publishVersionTx(tx, tenantId, policy.id, 1, membershipId, dto.rules);

      await this.auditService.createLogRequired(
        {
          tenantId,
          actorMembershipId: membershipId,
          action: 'INCOME_POLICY_CREATE',
          entityType: 'IncomePolicy',
          entityId: policy.id,
          metadata: {
            categoryId: dto.categoryId,
            categoryName: category.name,
            version: version.version,
          },
        },
        tx,
      );

      const withRules = await tx.incomePolicyVersion.findUnique({
        where: { id: version.id },
        include: { rules: true },
      });
      return this.toPolicyDto({ ...policy, versions: [withRules!] });
    });
  }

  // ── Publish a new version ───────────────────────────────────────────────

  async createVersion(
    tenantId: string,
    categoryId: string,
    membershipId: string,
    userRoles: string[],
    dto: CreateIncomePolicyVersionDto,
  ): Promise<IncomePolicyResponseDto> {
    this.assertAdminOrOperator(userRoles, 'publicar versiones de políticas');
    this.assertValidRules(dto.rules);

    return this.prisma.$transaction(async (tx) => {
      await this.acquirePolicyLock(tx, tenantId, categoryId);

      const policy = await tx.incomePolicy.findUnique({
        where: { tenantId_categoryId: { tenantId, categoryId } },
      });
      if (!policy) {
        throw new NotFoundException('No existe política para esta categoría en el tenant');
      }

      const lastVersion = await tx.incomePolicyVersion.findFirst({
        where: { policyId: policy.id },
        orderBy: { version: 'desc' },
      });
      const nextVersion = (lastVersion?.version ?? 0) + 1;

      // Desactivar la versión current (historia preservada, nunca DELETE).
      await tx.incomePolicyVersion.updateMany({
        where: { policyId: policy.id, status: IncomePolicyVersionStatus.ACTIVE },
        data: { status: IncomePolicyVersionStatus.INACTIVE },
      });

      const version = await this.publishVersionTx(tx, tenantId, policy.id, nextVersion, membershipId, dto.rules);

      await this.auditService.createLogRequired(
        {
          tenantId,
          actorMembershipId: membershipId,
          action: 'INCOME_POLICY_VERSION_CREATE',
          entityType: 'IncomePolicyVersion',
          entityId: version.id,
          metadata: {
            categoryId,
            policyId: policy.id,
            version: nextVersion,
            previousVersion: lastVersion?.version ?? null,
          },
        },
        tx,
      );

      const withRules = await tx.incomePolicyVersion.findUnique({
        where: { id: version.id },
        include: { rules: true },
      });
      const versions = await tx.incomePolicyVersion.findMany({
        where: { policyId: policy.id },
        include: { rules: true },
        orderBy: { version: 'desc' },
      });
      return this.toPolicyDto({ ...policy, versions: [...versions] });
    });
  }

  // ── Deactivate ──────────────────────────────────────────────────────────

  async deactivatePolicy(
    tenantId: string,
    categoryId: string,
    membershipId: string,
    userRoles: string[],
  ): Promise<IncomePolicyResponseDto> {
    this.assertAdminOrOperator(userRoles, 'desactivar políticas de ingresos');

    return this.prisma.$transaction(async (tx) => {
      await this.acquirePolicyLock(tx, tenantId, categoryId);

      const policy = await tx.incomePolicy.findUnique({
        where: { tenantId_categoryId: { tenantId, categoryId } },
      });
      if (!policy) {
        throw new NotFoundException('No existe política para esta categoría en el tenant');
      }

      const result = await tx.incomePolicyVersion.updateMany({
        where: { policyId: policy.id, status: IncomePolicyVersionStatus.ACTIVE },
        data: { status: IncomePolicyVersionStatus.INACTIVE },
      });

      await this.auditService.createLogRequired(
        {
          tenantId,
          actorMembershipId: membershipId,
          action: 'INCOME_POLICY_DEACTIVATE',
          entityType: 'IncomePolicy',
          entityId: policy.id,
          metadata: {
            categoryId,
            deactivatedVersions: result.count,
          },
        },
        tx,
      );

      const versions = await tx.incomePolicyVersion.findMany({
        where: { policyId: policy.id },
        include: { rules: true },
        orderBy: { version: 'desc' },
      });
      return this.toPolicyDto({ ...policy, versions });
    });
  }

  // ── Internos ────────────────────────────────────────────────────────────

  private async publishVersionTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    policyId: string,
    versionNumber: number,
    membershipId: string,
    rules: Array<{ destinationType: IncomeApplicationDestination; fundId?: string; percentageBasisPoints: number }>,
  ): Promise<Prisma.IncomePolicyVersionGetPayload<Record<string, never>>> {
    // Validar Funds referenciados (tenant + ACTIVE) con locks en orden determinístico.
    const fundIds = [...new Set(
      rules
        .filter((rule) => rule.destinationType === IncomeApplicationDestination.FUND)
        .map((rule) => rule.fundId as string),
    )].sort();

    for (const fundId of fundIds) {
      await acquireFundLock(tx, tenantId, fundId);
    }

    if (fundIds.length > 0) {
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
    }

    const version = await tx.incomePolicyVersion.create({
      data: {
        policyId,
        version: versionNumber,
        status: IncomePolicyVersionStatus.ACTIVE,
        createdByMembershipId: membershipId,
      },
    });

    for (const rule of rules) {
      const isFund = rule.destinationType === IncomeApplicationDestination.FUND;
      await tx.incomePolicyRule.create({
        data: {
          tenantId,
          versionId: version.id,
          destinationType: rule.destinationType,
          fundId: isFund ? rule.fundId! : null,
          percentageBasisPoints: rule.percentageBasisPoints,
        },
      });
    }

    return version;
  }

  private async acquirePolicyLock(tx: Prisma.TransactionClient, tenantId: string, categoryId: string): Promise<void> {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${incomePolicyLockKey(tenantId, categoryId)}, 0))`,
    );
  }

  private assertAdminOrOperator(userRoles: string[], action: string): void {
    if (!this.validators.isAdminOrOperator(userRoles)) {
      throw new ForbiddenException(`Solo administradores pueden ${action}`);
    }
  }

  private async assertIncomeCategory(
    tenantId: string,
    categoryId: string,
  ): Promise<{ id: string; name: string }> {
    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: { id: categoryId, tenantId },
      select: { id: true, name: true, movementType: true },
    });
    if (!category) {
      throw new NotFoundException('Categoría no encontrada o no pertenece al tenant');
    }
    if (category.movementType !== 'INCOME') {
      throw new BadRequestException('La categoría no es de tipo INGRESO');
    }
    return category;
  }

  /** Validaciones estáticas: suma exacta 10000 bp, sin duplicados, invariante fund. */
  private assertValidRules(
    rules: Array<{ destinationType: IncomeApplicationDestination; fundId?: string; percentageBasisPoints: number }>,
  ): void {
    const seenNonFund = new Set<IncomeApplicationDestination>();
    const seenFund = new Set<string>();
    let totalBp = 0;

    for (const rule of rules) {
      if (!Number.isInteger(rule.percentageBasisPoints) || rule.percentageBasisPoints <= 0 || rule.percentageBasisPoints > 10000) {
        throw new BadRequestException(
          `percentageBasisPoints debe ser un entero entre 1 y 10000 (recibido: ${rule.percentageBasisPoints})`,
        );
      }
      if (rule.destinationType === IncomeApplicationDestination.FUND) {
        if (rule.fundId === undefined || rule.fundId === null) {
          throw new BadRequestException('fundId es obligatorio para destinationType FUND');
        }
        if (seenFund.has(rule.fundId)) {
          throw new BadRequestException(`No puede haber dos reglas FUND hacia el mismo fondo: ${rule.fundId}`);
        }
        seenFund.add(rule.fundId);
      } else {
        if (rule.fundId !== undefined && rule.fundId !== null) {
          throw new BadRequestException(`fundId no aplica para destinationType ${rule.destinationType}`);
        }
        if (seenNonFund.has(rule.destinationType)) {
          throw new BadRequestException(`No puede haber dos reglas ${rule.destinationType} en la misma política`);
        }
        seenNonFund.add(rule.destinationType);
      }
      totalBp += rule.percentageBasisPoints;
    }

    if (totalBp !== 10000) {
      throw new BadRequestException(
        `La suma de porcentajes debe ser exactamente 10000 bp (100%), sumó: ${totalBp}`,
      );
    }
  }

  private toRuleDto(rule: Prisma.IncomePolicyRuleGetPayload<Record<string, never>>): IncomePolicyRuleResponseDto {
    return {
      id: rule.id,
      destinationType: rule.destinationType,
      fundId: rule.fundId,
      percentageBasisPoints: rule.percentageBasisPoints,
    };
  }

  private toVersionDto(version: VersionWithRules): IncomePolicyVersionResponseDto {
    return {
      id: version.id,
      version: version.version,
      status: version.status,
      rules: version.rules.map((rule) => this.toRuleDto(rule)),
      createdAt: version.createdAt,
    };
  }

  private toPolicyDto(policy: {
    id: string;
    tenantId: string;
    categoryId: string;
    versions: VersionWithRules[];
  }): IncomePolicyResponseDto {
    const sorted = [...policy.versions].sort((a, b) => b.version - a.version);
    const current = sorted.find((v) => v.status === IncomePolicyVersionStatus.ACTIVE) ?? null;
    return {
      id: policy.id,
      tenantId: policy.tenantId,
      categoryId: policy.categoryId,
      currentVersion: current ? this.toVersionDto(current) : null,
      versions: sorted.map((v) => this.toVersionDto(v)),
    };
  }
}
