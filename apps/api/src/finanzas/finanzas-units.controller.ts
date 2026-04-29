import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FinanzasService } from './finanzas.service';
import { AuthenticatedRequest } from '../common/types/request.types';
import { resolveTenantId } from '../common/tenant-context/tenant-context.resolver';

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
    const tenantId = resolveTenantId(req, {
      allowHeaderFallback: true,
      requireMembership: true,
    });
    const userId = req.user.id;
    const userRoles = req.user.roles || [];

    return this.finanzasService.getUnitLedger(
      tenantId,
      unitId,
      periodFrom || undefined,
      periodTo || undefined,
      userRoles,
      userId,
    );
  }
}
