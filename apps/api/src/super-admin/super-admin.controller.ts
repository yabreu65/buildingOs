import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { SuperAdminService } from './super-admin.service';
import { TenancyStatsService } from '../tenancy/tenancy-stats.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { StartImpersonationDto } from './dto/start-impersonation.dto';

export interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    isSuperAdmin?: boolean;
    isImpersonating?: boolean;
    impersonatedTenantId?: string;
    actorSuperAdminUserId?: string;
  };
}

/**
 * SuperAdminController: Manages SUPER_ADMIN operations
 *
 * SECURITY:
 * - All endpoints protected by JwtAuthGuard + SuperAdminGuard
 * - SuperAdminGuard validates JWT + SUPER_ADMIN role
 * - No multi-tenant scoping (global SUPER_ADMIN access)
 */
@Controller('api/super-admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SuperAdminController {
  constructor(
    private readonly service: SuperAdminService,
    private readonly tenancyStatsService: TenancyStatsService,
  ) {}

  /**
   * POST /api/super-admin/tenants
   * Create new tenant
   */
  @Post('tenants')
  @HttpCode(HttpStatus.CREATED)
  async createTenant(
    @Body() dto: CreateTenantDto,
    @Request() req: RequestWithUser,
  ) {
    return this.service.createTenant(dto, req.user.id);
  }

  /**
   * GET /api/super-admin/tenants
   * List all tenants (paginated)
   */
  @Get('tenants')
  async listTenants(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.service.listTenants(
      parseInt(skip || '0'),
      parseInt(take || '20'),
    );
  }

  /**
   * GET /api/super-admin/tenants/:tenantId
   * Get single tenant
   */
  @Get('tenants/:tenantId')
  async getTenant(@Param('tenantId') tenantId: string) {
    return this.service.getTenant(tenantId);
  }

  /**
   * PATCH /api/super-admin/tenants/:tenantId
   * Update tenant
   */
  @Patch('tenants/:tenantId')
  async updateTenant(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateTenantDto,
    @Request() req: RequestWithUser,
  ) {
    return this.service.updateTenant(tenantId, dto, req.user.id);
  }

  /**
   * DELETE /api/super-admin/tenants/:tenantId
   * Delete tenant (irreversible)
   */
  @Delete('tenants/:tenantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTenant(
    @Param('tenantId') tenantId: string,
    @Request() req: RequestWithUser,
  ): Promise<void> {
    return this.service.deleteTenant(tenantId, req.user.id);
  }

  /**
   * PATCH /api/super-admin/tenants/:tenantId/subscription
   * Change tenant plan
   */
  @Patch('tenants/:tenantId/subscription')
  async changePlan(
    @Param('tenantId') tenantId: string,
    @Body() dto: ChangePlanDto,
    @Request() req: RequestWithUser,
  ) {
    return this.service.changePlan(tenantId, dto, req.user.id);
  }

  /**
   * GET /api/super-admin/tenants/:tenantId/billing
   * Get tenant billing information (subscription, plan, usage)
   */
  @Get('tenants/:tenantId/billing')
  async getTenantBilling(@Param('tenantId') tenantId: string) {
    return this.tenancyStatsService.getTenantBilling(tenantId);
  }

  /**
   * GET /api/super-admin/stats
   * Global stats dashboard
   */
  @Get('stats')
  async getStats() {
    return this.service.getStats();
  }

  /**
   * GET /api/super-admin/audit-logs
   * Audit trail (with optional filters)
   */
  @Get('audit-logs')
  async getAuditLogs(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('tenantId') tenantId?: string,
    @Query('action') action?: string,
  ) {
    return this.service.getAuditLogs(
      parseInt(skip || '0'),
      parseInt(take || '50'),
      {
        tenantId,
        action,
      },
    );
  }

  /**
   * POST /api/super-admin/impersonation/start
   * Start impersonation of a tenant (mint short-lived token)
   * SECURITY: Requires SUPER_ADMIN role
   */
  @Post('impersonation/start')
  @HttpCode(HttpStatus.OK)
  async startImpersonation(
    @Body() dto: StartImpersonationDto,
    @Request() req: RequestWithUser,
  ) {
    return this.service.startImpersonation(dto.tenantId, req.user.id);
  }

  /**
   * POST /api/super-admin/impersonation/end
   * End impersonation (audit the end event)
   * SECURITY: Can be called with either SA token or impersonation token
   */
  @Post('impersonation/end')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard) // Only JwtAuthGuard, not SuperAdminGuard (impersonation token should work too)
  async endImpersonation(@Request() req: RequestWithUser) {
    const tenantId = req.user.impersonatedTenantId || 'unknown';
    const actorUserId = req.user.actorSuperAdminUserId || req.user.id;
    return this.service.endImpersonation(tenantId, actorUserId);
  }

  /**
   * GET /api/super-admin/impersonation/status
   * Get current impersonation status
   * SECURITY: Requires JwtAuth (works with both SA and impersonation tokens)
   */
  @Get('impersonation/status')
  @UseGuards(JwtAuthGuard)
  async getImpersonationStatus(@Request() req: RequestWithUser) {
    return this.service.getImpersonationStatus(req);
  }
}
