/**
 * AI Template Controller
 *
 * Endpoints:
 * - GET /assistant/templates - List available templates
 * - POST /assistant/template-run - Execute template and get output
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireFeature, RequireFeatureGuard } from '../billing/require-feature.guard';
import { AiTemplateService, TemplateRunRequest, TemplateRunResponse } from './template.service';

@Controller('assistant')
@UseGuards(JwtAuthGuard, RequireFeatureGuard)
export class AiTemplateController {
  constructor(private readonly templateService: AiTemplateService) {}

  /**
   * GET /assistant/templates?scope=TENANT|BUILDING|UNIT
   *
   * List templates available to user based on:
   * - Permissions (requiredPermissions array)
   * - Scope (TENANT, BUILDING, UNIT)
   * - Status (isActive && enabledByDefault)
   *
   * Returns:
   * - id, key, name, description
   * - scopeType, category
   * - requiredPermissions
   * - maxOutputTokens
   */
  @Get('templates')
  async getTemplates(
    @Query('scope') scope?: string,
    @Request() req?: any,
  ) {
    const tenantId = req.user?.activeTenantId || req.headers['x-tenant-id'];
    const membership = req.user?.memberships?.find((m: any) => m.tenantId === tenantId);
    const userRoles = membership?.roles || [];

    if (!tenantId) {
      throw new BadRequestException('tenantId is required (via X-Tenant-Id or session)');
    }
    if (!membership) {
      throw new ForbiddenException('No access to tenant');
    }

    const scopeType = scope || undefined;

    return this.templateService.getAvailableTemplates(tenantId, userRoles, scopeType);
  }

  /**
   * POST /assistant/template-run
   *
   * Execute a template and get output
   *
   * Request body:
   * {
   *   "templateKey": "TICKET_REPLY_DRAFT",
   *   "context": {
   *     "buildingId": "building1",
   *     "unitId": "unit1",
   *     "page": "tickets"
   *   },
   *   "input": {
   *     "ticket_title": "...",
   *     "ticket_description": "...",
   *     "last_comment": "..."
   *   }
   * }
   *
   * Response:
   * {
   *   "answer": "Respuesta borrador aquí...",
   *   "suggestedActions": [...],
   *   "followUpQuestions": ["¿Ajustar algo?", ...]
   * }
   *
   * Features:
   * - Uses router (small/big model)
   * - Uses cache (separate cache per template+input)
   * - Uses budget guard (rate limit, monthly limit)
   * - Injects context enrichment
   * - Logs to audit trail
   *
   * Errors:
   * - 400: Template not found, invalid input
   * - 403: Missing permissions for template
   * - 409: Budget exceeded (CONFLICT)
   * - 429: Rate limit exceeded
   * - 451: Feature not available (requires ENTERPRISE plan)
   */
  @Post('template-run')
  @RequireFeature('canUseAI')
  async runTemplate(
    @Body() request: TemplateRunRequest,
    @Request() req?: any,
  ): Promise<TemplateRunResponse> {
    const tenantId = req.user?.activeTenantId || req.headers['x-tenant-id'];
    const membershipId = req.user?.activeMembershipId;
    const userId = req.user?.id;
    const memberships = req.user?.memberships || [];

    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }

    if (!membershipId || !userId) {
      throw new BadRequestException('User context is required');
    }

    // Get user roles for this tenant
    const membership = memberships.find((m: any) => m.tenantId === tenantId);
    const userRoles = membership?.roles || [];
    if (!membership) {
      throw new ForbiddenException('No access to tenant');
    }

    return this.templateService.runTemplate(
      tenantId,
      membershipId,
      userId,
      userRoles,
      request,
    );
  }
}
