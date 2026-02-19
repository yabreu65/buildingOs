/**
 * AI Budget Controller
 *
 * Endpoints for managing AI budget per tenant.
 * - Tenant endpoints: view own usage
 * - Super-Admin endpoints: manage budgets for tenants
 */

import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';
import { AiBudgetService, UsageData } from './budget.service';

@Controller('tenants')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class AiBudgetController {
  constructor(private readonly budgetService: AiBudgetService) {}

  /**
   * GET /tenants/:tenantId/ai/usage
   *
   * Tenant endpoint: View own AI usage for current month
   * Accessible by: Any user in the tenant (can only see their own tenant's data)
   *
   * Returns:
   * - month: Current month (YYYY-MM)
   * - budgetCents: Monthly budget in cents
   * - calls: Number of AI calls made
   * - inputTokens: Total input tokens used
   * - outputTokens: Total output tokens used
   * - estimatedCostCents: Estimated cost in cents
   * - percentUsed: Percentage of budget used (0-100)
   * - warnedAt: When 80% threshold was crossed (if any)
   * - blockedAt: When 100% was exceeded (if any)
   */
  @Get(':tenantId/ai/usage')
  async getAiUsage(
    @Param('tenantId') tenantId: string,
    @Query('month') month?: string,
  ): Promise<UsageData> {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId is required');
    }

    return this.budgetService.getUsageData(tenantId, month);
  }

  /**
   * GET /super-admin/tenants/:tenantId/ai/usage
   *
   * Super-admin endpoint: View any tenant's AI usage
   * Accessible by: SUPER_ADMIN only
   *
   * Query params:
   * - month?: "YYYY-MM" (defaults to current month)
   *
   * Returns: Same as tenant endpoint
   */
  @UseGuards(SuperAdminGuard)
  @Get('super-admin/tenants/:tenantId/ai/usage')
  async getSuperAdminAiUsage(
    @Param('tenantId') tenantId: string,
    @Query('month') month?: string,
  ): Promise<UsageData> {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId is required');
    }

    return this.budgetService.getUsageData(tenantId, month);
  }

  /**
   * PATCH /super-admin/tenants/:tenantId/ai/budget
   *
   * Super-admin endpoint: Update tenant's monthly AI budget
   * Accessible by: SUPER_ADMIN only
   *
   * Request body:
   * - monthlyBudgetCents: Number (0 to 500000, representing $0-$5000/month)
   *
   * Errors:
   * - 400: Invalid budget amount (not in range)
   * - 403: Not super-admin
   *
   * Audit:
   * - Creates AI_BUDGET_UPDATED audit log with previous/new amounts
   */
  @UseGuards(SuperAdminGuard)
  @Patch('super-admin/tenants/:tenantId/ai/budget')
  async updateAiBudget(
    @Param('tenantId') tenantId: string,
    @Body() body: { monthlyBudgetCents: number },
    @Request() req?: any,
  ): Promise<{ success: boolean }> {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new BadRequestException('tenantId is required');
    }

    if (!body || typeof body.monthlyBudgetCents !== 'number') {
      throw new BadRequestException('monthlyBudgetCents is required and must be a number');
    }

    const actorUserId = req?.user?.id;

    await this.budgetService.updateBudget(
      tenantId,
      body.monthlyBudgetCents,
      actorUserId,
    );

    return { success: true };
  }
}
