import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  ConflictException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DemoSeedService } from './demo-seed.service';

interface DemoSeedResult {
  success: boolean;
  summary: {
    buildingsCreated: number;
    unitsCreated: number;
    usersCreated: number;
    occupantsCreated: number;
    ticketsCreated: number;
    supportTicketsCreated: number;
    paymentsCreated: number;
    documentsCreated: number;
  };
}

/**
 * DemoSeedWizard Controller
 *
 * ENDPOINTS (SUPER_ADMIN only):
 * GET    /super-admin/tenants/:tenantId/demo-seed/check     → Check if can generate
 * POST   /super-admin/tenants/:tenantId/demo-seed/generate  → Generate demo data
 */

@Controller('super-admin/tenants/:tenantId/demo-seed')
@UseGuards(JwtAuthGuard)
export class DemoSeedController {
  constructor(private demoSeedService: DemoSeedService) {}

  /**
   * Check if demo data can be generated for tenant
   * GET /super-admin/tenants/:tenantId/demo-seed/check
   */
  @Get('check')
  async checkCanGenerate(@Param('tenantId') tenantId: string) {
    const result = await this.demoSeedService.canGenerateDemoData(tenantId);
    return result;
  }

  /**
   * Generate demo data for TRIAL tenant
   * POST /super-admin/tenants/:tenantId/demo-seed/generate
   */
  @Post('generate')
  async generateDemo(
    @Param('tenantId') tenantId: string,
    @Request() req: any,
  ): Promise<DemoSeedResult> {
    const user = req.user;

    // Verify user is SUPER_ADMIN
    if (!user.roles || !user.roles.includes('SUPER_ADMIN')) {
      throw new ConflictException('Only SUPER_ADMIN can generate demo data');
    }

    return this.demoSeedService.generateDemoData(tenantId, user.id);
  }
}
