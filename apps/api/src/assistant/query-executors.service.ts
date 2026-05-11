import { Injectable } from '@nestjs/common';
import { PaymentStatus, UnitOccupantRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantQueryParser, UnitToken } from './query-parser/assistant-query-parser';
import { AssistantPolicyEnforcerService } from './policy-enforcer.service';
import { AssistantUnitResolverService, ResolvedUnit } from './unit-resolver/assistant-unit-resolver.service';
import type { ChatResponse } from './ai.types';
import type { AssistantQueryExecutionContext } from './query-plan.types';

@Injectable()
export class AssistantQueryExecutorsService {
  private readonly parser = new AssistantQueryParser();

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AssistantPolicyEnforcerService,
    private readonly unitResolver: AssistantUnitResolverService,
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
      case 'unit_tickets':
        return this.executeUnitTickets(context);
      case 'building_tickets':
        return this.executeBuildingTickets(context);
      case 'building_stats':
        return this.executeBuildingStats(context);
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

    const outstanding = charges.reduce((sum, charge) => {
      const approvedAllocated = charge.paymentAllocations.reduce((allocationSum, allocation) => {
        const status = allocation.payment?.status;
        if (status === PaymentStatus.APPROVED || status === PaymentStatus.RECONCILED) {
          return allocationSum + allocation.amount;
        }
        return allocationSum;
      }, 0);
      return sum + Math.max(0, charge.amount - approvedAllocated);
    }, 0);

    const amountText = this.formatMoney(outstanding, tenant.currency);
    return this.response(
      outstanding > 0
        ? `La unidad ${resolved.displayCode} (${resolved.building.name}) tiene una deuda pendiente de ${amountText}.`
        : `La unidad ${resolved.displayCode} (${resolved.building.name}) no tiene deuda pendiente. Saldo actual: ${amountText}.`,
      'VIEW_PAYMENTS',
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

    const outstanding = charges.reduce((sum, charge) => {
      const approvedAllocated = charge.paymentAllocations.reduce((allocationSum, allocation) => {
        const status = allocation.payment?.status;
        if (status === PaymentStatus.APPROVED || status === PaymentStatus.RECONCILED) {
          return allocationSum + allocation.amount;
        }
        return allocationSum;
      }, 0);
      return sum + Math.max(0, charge.amount - approvedAllocated);
    }, 0);

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
      where: { tenantId: context.tenantId },
      select: { id: true, name: true },
    });
    const match = this.parser.findBuilding(buildings, token);
    return match.matched ? match.item : null;
  }

  private response(
    answer: string,
    actionType: 'VIEW_REPORTS' | 'VIEW_PAYMENTS' | 'VIEW_TICKETS',
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
