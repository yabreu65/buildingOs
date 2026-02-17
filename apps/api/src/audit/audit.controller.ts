import { Controller, Get, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditService, AuditLogQueryFilters } from './audit.service';
import { AuditAction } from '@prisma/client';

export interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    name: string;
    memberships: Array<{
      tenantId: string;
      roles: string[];
    }>;
  };
}

/**
 * AuditController: Query audit logs
 *
 * ACCESS CONTROL:
 * - SUPER_ADMIN: Can query all tenants or filter by specific tenantId
 * - TENANT_ADMIN/OWNER/OPERATOR: Forced to their own primary tenantId
 * - RESIDENT: 403 Forbidden (no audit access)
 *
 * ENDPOINT: GET /audit/logs
 * QUERY PARAMS:
 *   - tenantId (optional, forced if not SUPER_ADMIN)
 *   - actorUserId (optional)
 *   - action (optional, any AuditAction enum value)
 *   - entityType (optional, e.g., "Ticket", "Building")
 *   - dateFrom (optional, ISO date string)
 *   - dateTo (optional, ISO date string)
 *   - skip (optional, default 0)
 *   - take (optional, default 50, max 100)
 */
@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get('logs')
  async getLogs(
    @Request() req: RequestWithUser,
    @Query('tenantId') queryTenantId?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    // Check role: RESIDENT cannot access audit logs
    const userRoles = req.user.memberships.flatMap((m) => m.roles);
    const isSuperAdmin = userRoles.includes('SUPER_ADMIN');
    const isResident = userRoles.includes('RESIDENT') && !isSuperAdmin;

    if (isResident) {
      throw new ForbiddenException('Residents cannot access audit logs');
    }

    // Determine effective tenantId based on role
    let effectiveTenantId: string | undefined;

    if (isSuperAdmin) {
      // SUPER_ADMIN: use provided tenantId or undefined (no filter)
      effectiveTenantId = queryTenantId;
    } else {
      // TENANT_ADMIN/OWNER/OPERATOR: must use their tenantId
      const firstTenantId = req.user.memberships[0]?.tenantId;
      if (!firstTenantId) {
        return {
          data: [],
          total: 0,
          message: 'No active tenant',
        };
      }
      effectiveTenantId = firstTenantId;
      // Ignore queryTenantId if provided (security: force own tenant)
    }

    // Parse date filters
    const dateFromObj = dateFrom ? new Date(dateFrom) : undefined;
    const dateToObj = dateTo ? new Date(dateTo) : undefined;

    // Parse pagination
    const skipNum = skip ? Math.max(0, parseInt(skip, 10)) : 0;
    let takeNum = take ? Math.max(1, parseInt(take, 10)) : 50;
    takeNum = Math.min(takeNum, 100); // Max 100 per request

    // Build query filters
    const filters: AuditLogQueryFilters = {
      tenantId: effectiveTenantId,
      actorUserId,
      action: action ? (action as AuditAction) : undefined,
      entityType,
      dateFrom: dateFromObj,
      dateTo: dateToObj,
      skip: skipNum,
      take: takeNum,
    };

    const result = await this.auditService.queryLogs(filters);

    return {
      ...result,
      pagination: {
        skip: skipNum,
        take: takeNum,
        total: result.total,
      },
    };
  }
}
