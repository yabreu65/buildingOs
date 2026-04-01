import {
  Controller,
  Post,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExpenseLedgerSeedService } from './expense-seed.service';

@Controller('api/super-admin/tenants')
@UseGuards(JwtAuthGuard)
export class ExpenseSeedController {
  constructor(private readonly seedService: ExpenseLedgerSeedService) {}

  /**
   * Seed default expense categories for a tenant.
   * Backfill endpoint for tenants created before this feature was implemented.
   * Idempotent: calling multiple times returns the same result.
   *
   * Protected: SUPER_ADMIN role required
   *
   * @param tenantId - The tenant ID to seed
   * @param request - HTTP request with user context
   * @returns SeedResult with count of created and skipped categories
   */
  @Post(':tenantId/seed-expense-categories')
  async seedExpenseCategories(
    @Param('tenantId') tenantId: string,
    @Request() request: any,
  ) {
    // Inline SUPER_ADMIN check (same pattern as DemoSeedController)
    const userRoles = request.user?.roles || [];
    if (!userRoles.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('SUPER_ADMIN role required');
    }

    const result = await this.seedService.seedDefaultCategoriesForTenant(
      tenantId,
    );

    return {
      tenantId,
      ...result,
    };
  }
}
