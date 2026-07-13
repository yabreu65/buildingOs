import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditService } from './audit.service';

export interface RequestWithUser extends Request {
  tenantId?: string;
  user: {
    id: string;
    email: string;
    name: string;
    tenantId?: string;
    membershipId?: string;
    roles?: string[];
    effectiveMembership?: {
      id: string;
      tenantId: string;
      roles: string[];
    };
    memberships: Array<{
      id: string;
      tenantId: string;
      roles: string[];
    }>;
  };
}

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  async getLogs(
    @Request() req: RequestWithUser,
    @Query() query: AuditLogQueryDto,
  ) {
    const memberships = req.user?.memberships ?? [];
    const isSuperAdmin = memberships.some((membership) =>
      membership.roles.includes('SUPER_ADMIN'),
    );

    if (!isSuperAdmin && memberships.every((membership) => membership.roles.includes('RESIDENT'))) {
      throw new ForbiddenException('Residents cannot access audit logs');
    }

    const context = this.resolveAuditContext(req, query.tenantId, isSuperAdmin);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const filters = {
      actorUserId: query.actorUserId,
      action: query.action,
      entityType: query.entityType,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      skip,
      take: limit,
    };

    const result = isSuperAdmin
      ? await this.auditService.queryGlobalLogsForSuperAdmin(context.tenantId, filters)
      : await this.auditService.queryTenantLogs(context.tenantId, context.membershipId, filters);

    return {
      ...result,
      pagination: {
        page,
        limit,
        skip,
        take: limit,
        total: result.total,
      },
    };
  }

  private resolveAuditContext(
    req: RequestWithUser,
    requestedTenantId: string | undefined,
    isSuperAdmin: boolean,
  ): { tenantId: string; membershipId: string } {
    const normalizedRequestedTenantId = requestedTenantId?.trim();
    const memberships = req.user?.memberships ?? [];
    const effectiveMembership = req.user?.effectiveMembership;
    const directTenantId = req.tenantId?.trim() ?? req.user?.tenantId?.trim();

    if (isSuperAdmin) {
      if (!normalizedRequestedTenantId) {
        throw new BadRequestException('tenantId is required for super-admin audit queries');
      }

      return { tenantId: normalizedRequestedTenantId, membershipId: '' };
    }

    if (normalizedRequestedTenantId) {
      const requestedMembership = this.findMembershipForTenant(
        memberships,
        effectiveMembership,
        normalizedRequestedTenantId,
      );

      if (!requestedMembership) {
        throw new ForbiddenException('Residents cannot access audit logs');
      }

      return requestedMembership;
    }

    if (directTenantId) {
      const directMembership = this.findMembershipForTenant(
        memberships,
        effectiveMembership,
        directTenantId,
      );

      if (!directMembership) {
        throw new ForbiddenException('Residents cannot access audit logs');
      }

      return directMembership;
    }

    const eligibleMemberships = memberships.filter((membership) =>
      membership.roles.some((role) => role !== 'RESIDENT'),
    );

    if (eligibleMemberships.length === 0) {
      throw new ForbiddenException('Residents cannot access audit logs');
    }

    if (eligibleMemberships.length > 1) {
      throw new BadRequestException('Ambiguous tenant scope');
    }

    const [onlyMembership] = eligibleMemberships;
    if (!onlyMembership) {
      throw new ForbiddenException('Residents cannot access audit logs');
    }

    return { tenantId: onlyMembership.tenantId.trim(), membershipId: onlyMembership.id.trim() };
  }

  private findMembershipForTenant(
    memberships: RequestWithUser['user']['memberships'],
    effectiveMembership: RequestWithUser['user']['effectiveMembership'],
    tenantId: string,
  ): { tenantId: string; membershipId: string } | null {
    const effectiveMatchesTenant = effectiveMembership?.tenantId === tenantId;
    const membership = effectiveMatchesTenant
      ? {
          id: effectiveMembership.id,
          tenantId: effectiveMembership.tenantId,
          roles: effectiveMembership.roles,
        }
      : memberships.find((candidate) => candidate.tenantId === tenantId);

    if (!membership) {
      return null;
    }

    if (membership.roles.every((role) => role === 'RESIDENT')) {
      return null;
    }

    const membershipId = membership.id?.trim();
    if (!membershipId) {
      return null;
    }

    return { tenantId: membership.tenantId.trim(), membershipId };
  }
}
