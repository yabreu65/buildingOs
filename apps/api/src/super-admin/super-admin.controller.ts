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
import { BillingService } from '../billing/billing.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { UpdateAiOverrideDto } from './dto/update-ai-override.dto';
import { StartImpersonationDto } from './dto/start-impersonation.dto';
import { ListSuperAdminPlanChangeRequestsDto } from './dto/list-super-admin-plan-change-requests.dto';
import { RejectPlanChangeRequestDto } from './dto/reject-plan-change-request.dto';

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
    private readonly billingService: BillingService,
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

  /**
   * Phase 13: GET /api/super-admin/tenants/:tenantId/ai-overrides
   * Get AI overrides for a tenant
   * SECURITY: SuperAdminGuard
   */
  @Get('tenants/:tenantId/ai-overrides')
  async getAiOverrides(@Param('tenantId') tenantId: string) {
    return this.service.getAiOverrides(tenantId);
  }

  /**
   * Alias: GET /api/super-admin/tenants/:tenantId/ai/caps
   */
  @Get('tenants/:tenantId/ai/caps')
  async getAiCaps(@Param('tenantId') tenantId: string) {
    return this.service.getAiOverrides(tenantId);
  }

  /**
   * Phase 13: PATCH /api/super-admin/tenants/:tenantId/ai-overrides
   * Update AI overrides for a tenant
   * SECURITY: SuperAdminGuard
   */
  @Patch('tenants/:tenantId/ai-overrides')
  async updateAiOverrides(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateAiOverrideDto,
    @Request() req: RequestWithUser,
  ) {
    await this.service.updateAiOverrides(tenantId, dto, req.user.id);
    return { message: 'AI overrides updated successfully' };
  }

  /**
   * Alias: PATCH /api/super-admin/tenants/:tenantId/ai/caps
   */
  @Patch('tenants/:tenantId/ai/caps')
  async updateAiCaps(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpdateAiOverrideDto,
    @Request() req: RequestWithUser,
  ) {
    await this.service.updateAiOverrides(tenantId, dto, req.user.id);
    return { message: 'AI caps updated successfully' };
  }

  /**
   * GET /api/super-admin/plan-change-requests
   */
  @Get('plan-change-requests')
  listPlanChangeRequests(
    @Request() req: RequestWithUser,
    @Query() query: ListSuperAdminPlanChangeRequestsDto,
  ) {
    return this.billingService.listSuperAdminPlanChangeRequests(
      req.user,
      query.status,
    );
  }

  /**
   * POST /api/super-admin/plan-change-requests/:id/approve
   */
  @Post('plan-change-requests/:id/approve')
  approvePlanChangeRequest(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.billingService.approvePlanChangeRequest(req.user, id);
  }

  /**
   * POST /api/super-admin/plan-change-requests/:id/reject
   */
  @Post('plan-change-requests/:id/reject')
  rejectPlanChangeRequest(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: RejectPlanChangeRequestDto,
  ) {
    return this.billingService.rejectPlanChangeRequest(req.user, id, body.reason);
  }
}
