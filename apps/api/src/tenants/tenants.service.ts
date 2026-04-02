import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantBrandingResponseDto, UpdateTenantBrandingDto } from './dto/tenant-branding.dto';

export interface TenantSummary {
  id: string;
  name: string;
  type: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
}

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Obtiene todos los tenants donde el usuario tiene membership.
   * Ordenados por nombre ascendente.
   *
   * @param userId ID del usuario
   * @returns Array de TenantSummary
   */
  async listTenantsForUser(userId: string): Promise<TenantSummary[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: {
        tenant: true,
      },
      orderBy: {
        tenant: {
          name: 'asc',
        },
      },
    });

    return memberships.map((m) => ({
      id: m.tenant.id,
      name: m.tenant.name,
      type: m.tenant.type,
    }));
  }

  /**
   * Get tenant branding configuration (currency, locale, colors, etc.)
   *
   * @param tenantId Tenant ID
   * @returns TenantBrandingResponseDto
   * @throws NotFoundException if tenant not found
   */
  async getTenantBranding(tenantId: string): Promise<TenantBrandingResponseDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID "${tenantId}" not found`);
    }

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      brandName: tenant.brandName,
      logoFileId: tenant.logoFileId,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      theme: tenant.theme,
      emailFooter: tenant.emailFooter,
      currency: tenant.currency,
      locale: tenant.locale,
    };
  }

  /**
   * Update tenant branding configuration (currency, locale, colors, etc.)
   *
   * @param tenantId Tenant ID
   * @param updates Partial branding updates
   * @returns Updated TenantBrandingResponseDto
   * @throws NotFoundException if tenant not found
   */
  async updateTenantBranding(
    tenantId: string,
    updates: UpdateTenantBrandingDto,
  ): Promise<TenantBrandingResponseDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID "${tenantId}" not found`);
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        brandName: updates.brandName ?? tenant.brandName,
        logoFileId: updates.logoFileId ?? tenant.logoFileId,
        primaryColor: updates.primaryColor ?? tenant.primaryColor,
        secondaryColor: updates.secondaryColor ?? tenant.secondaryColor,
        theme: updates.theme ?? tenant.theme,
        emailFooter: updates.emailFooter ?? tenant.emailFooter,
        currency: updates.currency ?? tenant.currency,
        locale: updates.locale ?? tenant.locale,
      },
    });

    return {
      tenantId: updated.id,
      tenantName: updated.name,
      brandName: updated.brandName,
      logoFileId: updated.logoFileId,
      primaryColor: updated.primaryColor,
      secondaryColor: updated.secondaryColor,
      theme: updated.theme,
      emailFooter: updated.emailFooter,
      currency: updated.currency,
      locale: updated.locale,
    };
  }
}
