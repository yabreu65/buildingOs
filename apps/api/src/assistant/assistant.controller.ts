import {
  Controller,
  Post,
  Body,
  UseGuards,
  Param,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { RequireFeatureGuard, RequireFeature } from '../billing/require-feature.guard';
import { AssistantService, ChatRequest, ChatResponse } from './assistant.service';

@Controller('tenants/:tenantId/assistant')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

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
}
