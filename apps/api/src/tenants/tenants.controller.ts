import { Controller, Get, Patch, UseGuards, Request, Param, Body } from '@nestjs/common';
import { TenantsService, TenantSummary } from './tenants.service';
import { TenantBrandingResponseDto, UpdateTenantBrandingDto } from './dto/tenant-branding.dto';
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

  /**
   * GET /tenants/:tenantId/branding
   * Obtiene configuración de branding del tenant (currency, locale, colors, etc.)
   * Protegido por JWT
   *
   * @param tenantId Tenant ID
   * @returns TenantBrandingResponseDto
   */
  @UseGuards(JwtAuthGuard)
  @Get(':tenantId/branding')
  async getTenantBranding(
    @Param('tenantId') tenantId: string,
  ): Promise<TenantBrandingResponseDto> {
    return this.tenantsService.getTenantBranding(tenantId);
  }

  /**
   * PATCH /tenants/:tenantId/branding
   * Actualiza configuración de branding del tenant (currency, locale, colors, etc.)
   * Protegido por JWT
   *
   * @param tenantId Tenant ID
   * @param updates Partial updates de branding
   * @returns Updated TenantBrandingResponseDto
   */
  @UseGuards(JwtAuthGuard)
  @Patch(':tenantId/branding')
  async updateTenantBranding(
    @Param('tenantId') tenantId: string,
    @Body() updates: UpdateTenantBrandingDto,
  ): Promise<TenantBrandingResponseDto> {
    return this.tenantsService.updateTenantBranding(tenantId, updates);
  }
}
