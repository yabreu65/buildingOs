import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AuthenticatedMembership,
  AuthenticatedRequest,
} from '../common/types/request.types';
import { FinanzasService } from './finanzas.service';

/**
 * FinanzasUnitsController: Unit-level finance endpoints
 *
 * Routes: /units/:unitId/ledger
 *
 * Security:
 * 1. JwtAuthGuard: Requires valid JWT token
 * 2. Unit access validation at service layer
 * 3. RESIDENT role scope enforcement (can only view their units)
 */
@Controller('units/:unitId')
@UseGuards(JwtAuthGuard)
export class FinanzasUnitsController {
  constructor(private finanzasService: FinanzasService) {}

  private getTenantIdFromHeader(req: AuthenticatedRequest): string | undefined {
    const tenantHeader = req.headers['x-tenant-id'];

    if (typeof tenantHeader === 'string' && tenantHeader) {
      return tenantHeader;
    }

    return Array.isArray(tenantHeader) ? tenantHeader[0] : undefined;
  }

  private resolveTenantMembership(
    req: AuthenticatedRequest,
  ): AuthenticatedMembership {
    const tenantId =
      req.tenantId ?? this.getTenantIdFromHeader(req) ?? req.user.tenantId;

    if (!tenantId) {
      throw new BadRequestException('Tenant ID not found in user context');
    }

    const membership = req.user.memberships?.find(
      (item) => item.tenantId === tenantId,
    );

    if (!membership) {
      throw new ForbiddenException(`No tiene acceso al tenant ${tenantId}`);
    }

    req.tenantId = tenantId;
    req.user.tenantId = tenantId;
    req.user.membershipId = membership.id;
    req.user.roles = membership.roles;
    req.user.role = membership.roles[0];
    req.user.effectiveMembership = membership;

    return membership;
  }

  /**
   * GET /units/:unitId/ledger?periodFrom=&periodTo=
   * Get unit financial ledger
   *
   * Returns:
   * - charges: List of charges with allocated amounts
   * - payments: List of payments with allocated amounts
   * - balance: Total outstanding balance
   *
   * RESIDENT: Can only view their own units (404 otherwise)
   * Admin/Operator: Can view any unit
   */
  @Get('ledger')
  async getUnitLedger(
    @Param('unitId') unitId: string,
    @Query('periodFrom') periodFrom: string = '',
    @Query('periodTo') periodTo: string = '',
    @Request() req: AuthenticatedRequest,
  ) {
    const membership = this.resolveTenantMembership(req);
    const tenantId = membership.tenantId;
    const userId = req.user.id;
    const userRoles = membership.roles || [];

    return this.finanzasService.getUnitLedger(
      tenantId,
      unitId,
      periodFrom || undefined,
      periodTo || undefined,
      userRoles,
      userId,
      membership,
    );
  }
}
