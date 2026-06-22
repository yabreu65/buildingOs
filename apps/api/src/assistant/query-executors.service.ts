import { Injectable } from '@nestjs/common';
import { UnitOccupantRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantQueryParser, UnitToken } from './query-parser/assistant-query-parser';
import { AssistantPolicyEnforcerService } from './policy-enforcer.service';
import { AssistantUnitResolverService, ResolvedUnit } from './unit-resolver/assistant-unit-resolver.service';
import { AssistantDebtCalculatorService } from './assistant-debt-calculator.service';
import { AssistantTenantDebtService } from './tenant-debt.service';
import type { ChatResponse } from './ai.types';
import type { AssistantQueryExecutionContext } from './query-plan.types';

@Injectable()
export class AssistantQueryExecutorsService {
  private readonly parser = new AssistantQueryParser();

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AssistantPolicyEnforcerService,
    private readonly unitResolver: AssistantUnitResolverService,
    private readonly debtCalculator: AssistantDebtCalculatorService,
    private readonly tenantDebtService: AssistantTenantDebtService,
  ) {}

  /**
   * Execute an allowlisted QueryPlan. This method never accepts SQL from the model.
   */
  async execute(context: AssistantQueryExecutionContext): Promise<ChatResponse | null> {
    switch (context.plan.executor) {
      case 'unit_residents':
        return this.executeUnitResidents(context);
      case 'unit_debt':
        return this.executeUnitDebt(context);
      case 'unit_documents':
        return this.executeUnitDocuments(context);
      case 'unit_tickets':
        return this.executeUnitTickets(context);
      case 'unit_payments':
        return this.executeUnitPayments(context);
      case 'building_debt':
        return this.executeBuildingDebt(context);
      case 'building_delinquents':
        return this.executeBuildingDelinquents(context);
      case 'building_documents':
        return this.executeBuildingDocuments(context);
      case 'building_tickets':
        return this.executeBuildingTickets(context);
      case 'building_payments':
        return this.executeBuildingPayments(context);
      case 'building_stats':
        return this.executeBuildingStats(context);
      case 'tenant_debt':
        return this.executeTenantDebt(context);
      default:
        return null;
    }
  }

  private async executeUnitResidents(context: AssistantQueryExecutionContext): Promise<ChatResponse> {
    const unitResolution = await this.resolveUnit(context);
    if (unitResolution.errorResponse) {
      return unitResolution.errorResponse;
    }
    const resolved = unitResolution.resolved;
    await this.policy.assertCanExecute({
      tenantId: context.tenantId,
      userId: context.userId,
      userRoles: context.userRoles,
      plan: context.plan,
      buildingId: resolved.building.id,
      unitId: resolved.unit.id,
    });

    const occupants = await this.prisma.unitOccupant.findMany({
      where: { tenantId: context.tenantId, unitId: resolved.unit.id, endDate: null },
      include: { member: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });

    if (occupants.length === 0) {
      return this.response(
        `La unidad ${resolved.displayCode} (${resolved.building.name}) no tiene ocupantes activos asignados.`,
        'VIEW_REPORTS',
        resolved,
      );
    }

    const primaryOccupants = occupants.filter((occupant) => occupant.isPrimary);
    if (primaryOccupants.length > 1) {
      return this.response(
        `Hay más de un ocupante primario en la unidad ${resolved.displayCode} (${resolved.building.name}). Necesito que revises la asignación antes de confirmar un nombre.`,
        'VIEW_REPORTS',
        resolved,
      );
    }

    const selected = primaryOccupants[0]
      ?? occupants.find((occupant) => occupant.role === UnitOccupantRole.OWNER)
      ?? occupants[0];

    if (!selected?.member?.name) {
      return this.response(
        `La unidad ${resolved.displayCode} (${resolved.building.name}) tiene ocupante activo, pero sin nombre cargado.`,
        'VIEW_REPORTS',
        resolved,
      );
    }

    const roleLabel = selected.role === UnitOccupantRole.OWNER ? 'propietario/a' : 'residente';
    return this.response(
      `En ${resolved.building.name}, la unidad ${resolved.displayCode} tiene como ${roleLabel} principal a ${selected.member.name}.`,
      'VIEW_REPORTS',
      resolved,
    );
  }

  private async executeUnitDebt(context: AssistantQueryExecutionContext): Promise<ChatResponse> {
    const unitResolution = await this.resolveUnit(context);
    if (unitResolution.errorResponse) {
      return unitResolution.errorResponse;
    }
    const resolved = unitResolution.resolved;
    await this.policy.assertCanExecute({
      tenantId: context.tenantId,
      userId: context.userId,
      userRoles: context.userRoles,
      plan: context.plan,
      buildingId: resolved.building.id,
      unitId: resolved.unit.id,
    });

    const [tenant, charges] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: context.tenantId }, select: { currency: true } }),
      this.prisma.charge.findMany({
        where: { tenantId: context.tenantId, unitId: resolved.unit.id, canceledAt: null },
        include: { paymentAllocations: { include: { payment: { select: { status: true } } } } },
      }),
    ]);

    const outstanding = this.debtCalculator.calculateOutstanding(charges);

    const amountText = this.formatMoney(outstanding, tenant.currency);
    return this.response(
      outstanding > 0
        ? `La unidad ${resolved.displayCode} (${resolved.building.name}) tiene una deuda pendiente de ${amountText}.`
        : `La unidad ${resolved.displayCode} (${resolved.building.name}) no tiene deuda pendiente. Saldo actual: ${amountText}.`,
      'VIEW_PAYMENTS',
      resolved,
    );
  }

  private async executeUnitDocuments(context: AssistantQueryExecutionContext): Promise<ChatResponse> {
    const unitResolution = await this.resolveUnit(context);
    if (unitResolution.errorResponse) {
      return unitResolution.errorResponse;
    }
    const resolved = unitResolution.resolved;
    await this.policy.assertCanExecute({
      tenantId: context.tenantId,
      userId: context.userId,
      userRoles: context.userRoles,
      plan: context.plan,
      buildingId: resolved.building.id,
      unitId: resolved.unit.id,
    });

    const documents = await this.prisma.document.findMany({
      where: { tenantId: context.tenantId, unitId: resolved.unit.id },
      select: { id: true, title: true, category: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (documents.length === 0) {
      return this.response(
        `La unidad ${resolved.displayCode} (${resolved.building.name}) no tiene documentos registrados.`,
        'VIEW_DOCUMENTS',
        resolved,
      );
    }

    const documentList = documents.map((document, index) => `${index + 1}. ${document.title} (${document.category})`).join('\n');
    return this.response(
      `Documentos de la unidad ${resolved.displayCode} (${resolved.building.name}):\n${documentList}`,
      'VIEW_DOCUMENTS',
      resolved,
    );
  }

  private async executeUnitTickets(context: AssistantQueryExecutionContext): Promise<ChatResponse> {
    const unitResolution = await this.resolveUnit(context);
    if (unitResolution.errorResponse) {
      return unitResolution.errorResponse;
    }
    const resolved = unitResolution.resolved;
    await this.policy.assertCanExecute({
      tenantId: context.tenantId,
      userId: context.userId,
      userRoles: context.userRoles,
      plan: context.plan,
      buildingId: resolved.building.id,
      unitId: resolved.unit.id,
    });

    const [openCount, recentTickets] = await Promise.all([
      this.prisma.ticket.count({ where: { tenantId: context.tenantId, unitId: resolved.unit.id, status: 'OPEN' } }),
      this.prisma.ticket.findMany({
        where: { tenantId: context.tenantId, unitId: resolved.unit.id },
        select: { id: true, title: true, status: true, priority: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    if (recentTickets.length === 0) {
      return this.response(
        `La unidad ${resolved.displayCode} (${resolved.building.name}) no tiene tickets registrados.`,
        'VIEW_TICKETS',
        resolved,
      );
    }

    const ticketList = recentTickets.map((ticket, index) => `${index + 1}. ${ticket.title} [${ticket.status}]`).join('\n');
    const openText = openCount > 0 ? ` (${openCount} abiertos)` : '';
    return this.response(
      `Tickets de la unidad ${resolved.displayCode} (${resolved.building.name})${openText}:\n${ticketList}`,
      'VIEW_TICKETS',
      resolved,
    );
  }

  private async executeUnitPayments(context: AssistantQueryExecutionContext): Promise<ChatResponse> {
    const unitResolution = await this.resolveUnit(context);
    if (unitResolution.errorResponse) {
      return unitResolution.errorResponse;
    }
    const resolved = unitResolution.resolved;
    await this.policy.assertCanExecute({
      tenantId: context.tenantId,
      userId: context.userId,
      userRoles: context.userRoles,
      plan: context.plan,
      buildingId: resolved.building.id,
      unitId: resolved.unit.id,
    });

    const payments = await this.prisma.payment.findMany({
      where: { tenantId: context.tenantId, unitId: resolved.unit.id, canceledAt: null },
      select: { id: true, amount: true, currency: true, status: true, method: true, paidAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (payments.length === 0) {
      return this.response(
        `La unidad ${resolved.displayCode} (${resolved.building.name}) no tiene pagos registrados.`,
        'VIEW_PAYMENTS',
        resolved,
      );
    }

    const paymentList = payments.map((payment, index) => {
      const date = payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('es-AR') : 'sin fecha';
      return `${index + 1}. ${this.formatMoney(payment.amount, payment.currency)} (${payment.status}) - ${date}`;
    }).join('\n');

    return this.response(
      `Últimos pagos de la unidad ${resolved.displayCode} (${resolved.building.name}):\n${paymentList}`,
      'VIEW_PAYMENTS',
      resolved,
    );
  }

  private async executeBuildingDebt(context: AssistantQueryExecutionContext): Promise<ChatResponse | null> {
    const building = await this.resolveBuilding(context);
    if (!building) {
      return null;
    }

    await this.policy.assertCanExecute({
      tenantId: context.tenantId,
      userId: context.userId,
      userRoles: context.userRoles,
      plan: context.plan,
      buildingId: building.id,
    });

    const [tenant, charges] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: context.tenantId }, select: { currency: true } }),
      this.prisma.charge.findMany({
        where: { tenantId: context.tenantId, buildingId: building.id, canceledAt: null },
        include: { paymentAllocations: { include: { payment: { select: { status: true } } } } },
      }),
    ]);

    const outstanding = this.debtCalculator.calculateOutstanding(charges);
    return {
      answer: outstanding > 0
        ? `El edificio ${building.name} tiene una deuda pendiente total de ${this.formatMoney(outstanding, tenant.currency)}.`
        : `El edificio ${building.name} no tiene deuda pendiente. Saldo actual: ${this.formatMoney(outstanding, tenant.currency)}.`,
      suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id } }],
    };
  }

  private async executeTenantDebt(context: AssistantQueryExecutionContext): Promise<ChatResponse | null> {
    await this.policy.assertCanExecute({
      tenantId: context.tenantId,
      userId: context.userId,
      userRoles: context.userRoles,
      plan: context.plan,
    });

    const tenantDebt = await this.tenantDebtService.resolveTenantDebtSummary(context.tenantId);
    return {
      answer: tenantDebt.totalDebt > 0
        ? `La administración tiene una deuda pendiente total de ${this.formatMoney(tenantDebt.totalDebt, tenantDebt.currency)}.`
        : `La administración no tiene deuda pendiente. Saldo actual: ${this.formatMoney(tenantDebt.totalDebt, tenantDebt.currency)}.`,
      suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: {} }],
    };
  }

  private async executeBuildingDelinquents(context: AssistantQueryExecutionContext): Promise<ChatResponse | null> {
    const building = await this.resolveBuilding(context);
    if (!building) {
      return null;
    }

    await this.policy.assertCanExecute({
      tenantId: context.tenantId,
      userId: context.userId,
      userRoles: context.userRoles,
      plan: context.plan,
      buildingId: building.id,
    });

    const [tenant, units] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: context.tenantId }, select: { currency: true } }),
      this.prisma.unit.findMany({
        where: { tenantId: context.tenantId, buildingId: building.id },
        select: { id: true, code: true, label: true },
      }),
    ]);

    const unitIds = units.map((unit) => unit.id);
    const charges = await this.prisma.charge.findMany({
      where: { tenantId: context.tenantId, unitId: { in: unitIds }, canceledAt: null },
      include: { paymentAllocations: { include: { payment: { select: { status: true } } } } },
    });

    const debtByUnit = new Map<string, number>();
    for (const charge of charges) {
      const debt = this.debtCalculator.calculateChargeOutstanding(charge);
      debtByUnit.set(charge.unitId, (debtByUnit.get(charge.unitId) ?? 0) + debt);
    }

    const topDebtors = Array.from(debtByUnit.entries())
      .filter(([, debt]) => debt > 0)
      .sort(([, left], [, right]) => right - left)
      .slice(0, 10);

    if (topDebtors.length === 0) {
      return {
        answer: `El edificio ${building.name} no tiene unidades con deuda pendiente. Todas las unidades están al día.`,
        suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id } }],
      };
    }

    const debtorList = topDebtors.map(([unitId, debt], index) => {
      const unit = units.find((item) => item.id === unitId);
      const unitLabel = unit ? (unit.label || unit.code) : 'Desconocida';
      return `${index + 1}. ${unitLabel}: ${this.formatMoney(debt, tenant.currency)}`;
    }).join('\n');
    const totalDebt = topDebtors.reduce((sum, [, debt]) => sum + debt, 0);

    return {
      answer: `Top deudores del edificio ${building.name} (deuda total: ${this.formatMoney(totalDebt, tenant.currency)}):\n${debtorList}`,
      suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id } }],
    };
  }

  private async executeBuildingDocuments(context: AssistantQueryExecutionContext): Promise<ChatResponse | null> {
    const building = await this.resolveBuilding(context);
    if (!building) {
      return null;
    }

    await this.policy.assertCanExecute({
      tenantId: context.tenantId,
      userId: context.userId,
      userRoles: context.userRoles,
      plan: context.plan,
      buildingId: building.id,
    });

    const documents = await this.prisma.document.findMany({
      where: { tenantId: context.tenantId, buildingId: building.id },
      select: { id: true, title: true, category: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (documents.length === 0) {
      return {
        answer: `El edificio ${building.name} no tiene documentos registrados.`,
        suggestedActions: [{ type: 'VIEW_DOCUMENTS', payload: { buildingId: building.id } }],
      };
    }

    const documentList = documents.map((document, index) => `${index + 1}. ${document.title} (${document.category})`).join('\n');
    return {
      answer: `Documentos del edificio ${building.name}:\n${documentList}`,
      suggestedActions: [{ type: 'VIEW_DOCUMENTS', payload: { buildingId: building.id } }],
    };
  }

  private async executeBuildingTickets(context: AssistantQueryExecutionContext): Promise<ChatResponse | null> {
    const building = await this.resolveBuilding(context);
    if (!building) {
      return null;
    }

    await this.policy.assertCanExecute({
      tenantId: context.tenantId,
      userId: context.userId,
      userRoles: context.userRoles,
      plan: context.plan,
      buildingId: building.id,
    });

    const [openCount, recentTickets] = await Promise.all([
      this.prisma.ticket.count({ where: { tenantId: context.tenantId, buildingId: building.id, status: 'OPEN' } }),
      this.prisma.ticket.findMany({
        where: { tenantId: context.tenantId, buildingId: building.id },
        select: { id: true, title: true, status: true, priority: true, unitId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    if (recentTickets.length === 0) {
      return { answer: `El edificio ${building.name} no tiene tickets registrados.`, suggestedActions: [{ type: 'VIEW_TICKETS', payload: { buildingId: building.id } }] };
    }

    const ticketList = recentTickets.map((ticket, index) => `${index + 1}. ${ticket.title} [${ticket.status}]`).join('\n');
    const openText = openCount > 0 ? ` (${openCount} abiertos)` : '';
    return { answer: `Tickets del edificio ${building.name}${openText}:\n${ticketList}`, suggestedActions: [{ type: 'VIEW_TICKETS', payload: { buildingId: building.id } }] };
  }

  private async executeBuildingPayments(context: AssistantQueryExecutionContext): Promise<ChatResponse | null> {
    const building = await this.resolveBuilding(context);
    if (!building) {
      return null;
    }

    await this.policy.assertCanExecute({
      tenantId: context.tenantId,
      userId: context.userId,
      userRoles: context.userRoles,
      plan: context.plan,
      buildingId: building.id,
    });

    const payments = await this.prisma.payment.findMany({
      where: { tenantId: context.tenantId, buildingId: building.id, canceledAt: null },
      select: { id: true, amount: true, currency: true, status: true, method: true, paidAt: true, createdAt: true, unitId: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (payments.length === 0) {
      return {
        answer: `El edificio ${building.name} no tiene pagos registrados.`,
        suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id } }],
      };
    }

    const unitIds = [...new Set(payments.map((payment) => payment.unitId).filter((unitId): unitId is string => unitId !== null))];
    const units = await this.prisma.unit.findMany({
      where: { tenantId: context.tenantId, id: { in: unitIds } },
      select: { id: true, code: true, label: true },
    });

    const paymentList = payments.map((payment, index) => {
      const date = payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('es-AR') : 'sin fecha';
      const unit = units.find((item) => item.id === payment.unitId);
      const unitLabel = unit ? (unit.label || unit.code) : 'N/A';
      return `${index + 1}. ${this.formatMoney(payment.amount, payment.currency)} (${payment.status}) - ${unitLabel} - ${date}`;
    }).join('\n');

    return {
      answer: `Últimos pagos del edificio ${building.name}:\n${paymentList}`,
      suggestedActions: [{ type: 'VIEW_PAYMENTS', payload: { buildingId: building.id } }],
    };
  }

  private async executeBuildingStats(context: AssistantQueryExecutionContext): Promise<ChatResponse | null> {
    const building = await this.resolveBuilding(context);
    if (!building) {
      return null;
    }

    await this.policy.assertCanExecute({
      tenantId: context.tenantId,
      userId: context.userId,
      userRoles: context.userRoles,
      plan: context.plan,
      buildingId: building.id,
    });

    const [tenant, units, openTickets, totalTickets, charges] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: context.tenantId }, select: { currency: true } }),
      this.prisma.unit.findMany({ where: { tenantId: context.tenantId, buildingId: building.id }, select: { id: true } }),
      this.prisma.ticket.count({ where: { tenantId: context.tenantId, buildingId: building.id, status: 'OPEN' } }),
      this.prisma.ticket.count({ where: { tenantId: context.tenantId, buildingId: building.id } }),
      this.prisma.charge.findMany({
        where: { tenantId: context.tenantId, buildingId: building.id, canceledAt: null },
        include: { paymentAllocations: { include: { payment: { select: { status: true } } } } },
      }),
    ]);

    const outstanding = this.debtCalculator.calculateOutstanding(charges);

    const averageDebt = units.length > 0 ? Math.round(outstanding / units.length) : 0;
    return {
      answer: `Estadísticas del edificio ${building.name}:\n- Unidades: ${units.length}\n- Tickets abiertos: ${openTickets} de ${totalTickets} totales\n- Deuda total: ${this.formatMoney(outstanding, tenant.currency)}\n- Deuda promedio por unidad: ${this.formatMoney(averageDebt, tenant.currency)}`,
      suggestedActions: [
        { type: 'VIEW_REPORTS', payload: { buildingId: building.id } },
        { type: 'VIEW_TICKETS', payload: { buildingId: building.id } },
      ],
    };
  }

  private async resolveUnit(context: AssistantQueryExecutionContext): Promise<{ resolved: ResolvedUnit; errorResponse: null } | { resolved: null; errorResponse: ChatResponse }> {
    const token: UnitToken = {
      unitCode: context.plan.filters.unitCode ?? '',
      buildingAlias: context.plan.filters.buildingAlias,
      buildingName: context.plan.filters.buildingName,
    };
    const resolution = await this.unitResolver.resolve(context.tenantId, token);
    if (resolution.errorResponse) {
      return { resolved: null, errorResponse: resolution.errorResponse };
    }
    return { resolved: resolution.resolved, errorResponse: null };
  }

  private async resolveBuilding(context: AssistantQueryExecutionContext): Promise<{ id: string; name: string } | null> {
    const token = context.plan.filters.buildingToken;
    if (!token) {
      return null;
    }

    const buildings = await this.prisma.building.findMany({
      where: { tenantId: context.tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const match = this.parser.findBuilding(buildings, token);
    return match.matched ? match.item : null;
  }

  private response(
    answer: string,
    actionType: 'VIEW_REPORTS' | 'VIEW_PAYMENTS' | 'VIEW_TICKETS' | 'VIEW_DOCUMENTS',
    resolved: ResolvedUnit,
  ): ChatResponse {
    return {
      answer,
      suggestedActions: [{ type: actionType, payload: { buildingId: resolved.building.id, unitId: resolved.unit.id } }],
    };
  }

  private formatMoney(amountCents: number, currency: string): string {
    const amount = amountCents / 100;
    try {
      return new Intl.NumberFormat('es-VE', { style: 'currency', currency }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency}`;
    }
  }
}
