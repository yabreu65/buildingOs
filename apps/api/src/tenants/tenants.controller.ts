import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { TenantsService, TenantSummary } from './tenants.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    name: string;
  };
}

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * GET /tenants
   * Protegido por JWT: devuelve solo tenants donde el usuario tiene memberships.
   *
   * @param req Request con user del JWT
   * @returns Array de TenantSummary
   */
  @UseGuards(JwtAuthGuard)
  @Get()
  async listTenants(@Request() req: RequestWithUser): Promise<TenantSummary[]> {
    return this.tenantsService.listTenantsForUser(req.user.id);
  }
}
