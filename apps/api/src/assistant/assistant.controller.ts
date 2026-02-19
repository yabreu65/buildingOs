import {
  Controller,
  Post,
  Body,
  UseGuards,
  Param,
  Request,
  BadRequestException,
  Get,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { RequireFeatureGuard, RequireFeature } from '../billing/require-feature.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { AssistantService, ChatRequest, ChatResponse } from './assistant.service';
import { AiAnalyticsService, TenantAnalyticsResponse, TenantSummaryItem } from './analytics.service';
import { AiActionEventsService, CreateActionEventDto } from './action-events.service';

@Controller('tenants/:tenantId/assistant')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class AssistantController {
  constructor(
    private readonly assistantService: AssistantService,
    private readonly analyticsService: AiAnalyticsService,
    private readonly actionEventsService: AiActionEventsService,
  ) {}

  /**
   * POST /tenants/:tenantId/assistant/chat
   *
   * Contextual AI chat endpoint with rate limiting and RBAC
   *
   * Request body:
   * - message: string (required, max 2000 chars)
   * - page: string (required, for context tracking)
   * - buildingId?: string (optional, validates ownership)
   * - unitId?: string (optional, validates ownership)
   *
   * Returns:
   * - answer: string (AI response)
   * - suggestedActions: SuggestedAction[] (filtered by RBAC)
   *
   * Errors:
   * - 400: Missing/invalid message, invalid building/unit
   * - 403: Feature not available (canUseAI flag)
   * - 429: Rate limit exceeded (100 per day)
   */
  @Post(':tenantId/chat')
  @UseGuards(RequireFeatureGuard)
  @RequireFeature('canUseAI')
  async chat(
    @Param('tenantId') tenantId: string,
    @Body() request: ChatRequest,
    @Request() req?: any,
  ): Promise<ChatResponse> {
    // Validate tenantId
    if (!tenantId || tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId is required');
    }

    // Validate request
    if (!request || !request.message || !request.page) {
      throw new BadRequestException('message and page are required');
    }

    // Extract user info from JWT
    const userId = req.user?.id;
    const membership = req.user?.memberships?.find(
      (m: any) => m.tenantId === tenantId,
    );

    if (!userId || !membership) {
      throw new BadRequestException('User not found in tenant');
    }

    const membershipId = membership.id;
    const userRoles = membership.roles || [];

    return this.assistantService.chat(
      tenantId,
      userId,
      membershipId,
      request,
      userRoles,
    );
  }

  /**
   * PHASE 12: Analytics Endpoints
   */

  /**
   * POST /tenants/:tenantId/assistant/action-events
   *
   * Track suggested action clicks (fire-and-forget, never blocks)
   *
   * Request body:
   * - actionType: string (VIEW_TICKETS | CREATE_TICKET | etc)
   * - source: string ("CHAT" | "TEMPLATE")
   * - page: string (current page)
   * - buildingId?: string
   * - unitId?: string
   * - interactionId?: string (from chat response)
   *
   * Returns: 201 (no body)
   */
  @Post('action-events')
  async trackActionEvent(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateActionEventDto,
    @Request() req?: any,
  ): Promise<{ success: boolean }> {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId is required');
    }

    const membership = req.user?.memberships?.find(
      (m: any) => m.tenantId === tenantId,
    );

    if (!membership) {
      throw new BadRequestException('User not found in tenant');
    }

    // Fire-and-forget: never blocks
    void this.actionEventsService.trackClick(tenantId, membership.id, dto);

    return { success: true };
  }

  /**
   * GET /tenants/:tenantId/assistant/analytics?month=YYYY-MM
   *
   * Get AI analytics for a specific tenant
   * Tenant can only view their own analytics (enforced by TenantAccessGuard)
   *
   * Query:
   * - month?: string (default: current month)
   *
   * Returns: TenantAnalyticsResponse with usage, efficiency, adoption, templates, actions
   */
  @Get('analytics')
  async getTenantAnalytics(
    @Param('tenantId') tenantId: string,
    @Query('month') month?: string,
  ): Promise<TenantAnalyticsResponse> {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId is required');
    }

    return this.analyticsService.getTenantAnalytics(tenantId, month);
  }
}

/**
 * Super-Admin Analytics Controller
 * Separate namespace for super-admin only endpoints
 */
@Controller('super-admin/ai')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SuperAdminAiController {
  constructor(private readonly analyticsService: AiAnalyticsService) {}

  /**
   * GET /super-admin/ai/tenants?month=YYYY-MM
   *
   * Get AI analytics summary for all tenants (sorted by cost DESC)
   * Super-admin only
   *
   * Query:
   * - month?: string (default: current month)
   *
   * Returns: TenantSummaryItem[] sorted by estimatedCostCents DESC
   */
  @Get('tenants')
  async getAllTenantsAnalytics(@Query('month') month?: string): Promise<TenantSummaryItem[]> {
    return this.analyticsService.getAllTenantsAnalytics(month);
  }

  /**
   * GET /super-admin/ai/tenants/:tenantId?month=YYYY-MM
   *
   * Get detailed AI analytics for a specific tenant
   * Super-admin only
   *
   * Query:
   * - month?: string (default: current month)
   *
   * Returns: TenantDetailedAnalytics with full breakdown
   */
  @Get('tenants/:tenantId')
  async getTenantDetailedAnalytics(
    @Param('tenantId') tenantId: string,
    @Query('month') month?: string,
  ) {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId is required');
    }

    return this.analyticsService.getTenantDetailedAnalytics(tenantId, month);
  }
}
