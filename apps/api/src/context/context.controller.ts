import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContextService, UserContextData, ContextOptions } from './context.service';
import type { AuthenticatedRequest } from '../common/types/request.types';

export interface SetContextDto {
  activeBuildingId?: string | null;
  activeUnitId?: string | null;
}

/**
 * ContextController: User context switching (active building/unit per tenant)
 *
 * Endpoints:
 * GET  /me/context           → Get current context
 * POST /me/context           → Set active building/unit
 * GET  /me/context/options   → Get accessible buildings/units
 */
@Controller('me/context')
@UseGuards(JwtAuthGuard)
export class ContextController {
  constructor(private readonly contextService: ContextService) {}

  private getTenantId(req: AuthenticatedRequest): string {
    const tenantId = req.tenantId || req.headers['x-tenant-id'];

    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('Tenant ID is required (X-Tenant-Id header)');
    }

    return tenantId;
  }

  /**
   * GET /me/context
   * Get current active building/unit for user in active tenant
   */
  @Get()
  async getContext(@Req() req: AuthenticatedRequest): Promise<UserContextData> {
    const userId = req.user.id;
    const tenantId = this.getTenantId(req);

    return this.contextService.getContext(userId, tenantId);
  }

  /**
   * POST /me/context
   * Set active building and/or unit
   *
   * Body:
   * {
   *   activeBuildingId?: string;
   *   activeUnitId?: string;
   * }
   */
  @Post()
  async setContext(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SetContextDto,
  ): Promise<UserContextData> {
    const userId = req.user.id;
    const tenantId = this.getTenantId(req);

    return this.contextService.setContext(
      userId,
      tenantId,
      dto.activeBuildingId,
      dto.activeUnitId,
    );
  }

  /**
   * GET /me/context/options
   * Get accessible buildings and units for user
   *
   * Response:
   * {
   *   buildings: [{id, name}],
   *   unitsByBuilding: { [buildingId]: [{id, code, label}] }
   * }
   */
  @Get('options')
  async getContextOptions(@Req() req: AuthenticatedRequest): Promise<ContextOptions> {
    const userId = req.user.id;
    const tenantId = this.getTenantId(req);

    return this.contextService.getContextOptions(userId, tenantId);
  }
}
