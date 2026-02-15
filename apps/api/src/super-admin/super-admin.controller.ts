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
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ChangePlanDto } from './dto/change-plan.dto';

export interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    isSuperAdmin?: boolean;
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
  constructor(private readonly service: SuperAdminService) {}

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
}
