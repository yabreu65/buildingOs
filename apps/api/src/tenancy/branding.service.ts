import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateBrandingDto, GetBrandingResponseDto } from './dto/branding.dto';
import { AuditAction } from '@prisma/client';

/**
 * BrandingService: Manage tenant branding (logo, colors, name)
 *
 * Ensures:
 * - logoFileId validates to same tenant
 * - Colors are valid hex
 * - Only tenant admins can update
 */
@Injectable()
export class BrandingService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  /**
   * Get tenant's current branding
   */
  async getTenantBranding(tenantId: string): Promise<GetBrandingResponseDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      brandName: tenant.brandName || undefined,
      logoFileId: tenant.logoFileId || undefined,
      primaryColor: tenant.primaryColor || undefined,
      secondaryColor: tenant.secondaryColor || undefined,
      theme: tenant.theme || undefined,
      emailFooter: tenant.emailFooter || undefined,
    };
  }

  /**
   * Update tenant's branding
   * Only TENANT_ADMIN or TENANT_OWNER can update
   */
  async updateBranding(
    tenantId: string,
    dto: UpdateBrandingDto,
    userId: string,
  ): Promise<GetBrandingResponseDto> {
    // Validate tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // If logoFileId is being set, validate it belongs to this tenant
    if (dto.logoFileId && dto.logoFileId !== tenant.logoFileId) {
      const file = await this.prisma.file.findFirst({
        where: { id: dto.logoFileId, tenantId },
      });

      if (!file) {
        throw new ForbiddenException(
          'Logo file does not belong to this tenant or does not exist',
        );
      }

      // Validate it's an image file (simple check)
      if (!file.mimeType?.startsWith('image/')) {
        throw new BadRequestException('Logo file must be an image');
      }
    }

    // Store old values for audit diff
    const oldBranding = {
      brandName: tenant.brandName,
      logoFileId: tenant.logoFileId,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      theme: tenant.theme,
      emailFooter: tenant.emailFooter,
    };

    // Update tenant
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        brandName: dto.brandName ?? tenant.brandName,
        logoFileId: dto.logoFileId ?? tenant.logoFileId,
        primaryColor: dto.primaryColor ?? tenant.primaryColor,
        secondaryColor: dto.secondaryColor ?? tenant.secondaryColor,
        theme: dto.theme ?? tenant.theme,
        emailFooter: dto.emailFooter ?? tenant.emailFooter,
      },
    });

    // Audit: TENANT_BRANDING_UPDATED
    void this.auditService.createLog({
      tenantId,
      actorUserId: userId,
      action: AuditAction.TENANT_BRANDING_UPDATED,
      entityType: 'Tenant',
      entityId: tenantId,
      metadata: {
        changes: {
          before: oldBranding,
          after: {
            brandName: updated.brandName,
            logoFileId: updated.logoFileId,
            primaryColor: updated.primaryColor,
            secondaryColor: updated.secondaryColor,
            theme: updated.theme,
            emailFooter: updated.emailFooter,
          },
        },
      },
    });

    return {
      tenantId: updated.id,
      tenantName: updated.name,
      brandName: updated.brandName || undefined,
      logoFileId: updated.logoFileId || undefined,
      primaryColor: updated.primaryColor || undefined,
      secondaryColor: updated.secondaryColor || undefined,
      theme: updated.theme || undefined,
      emailFooter: updated.emailFooter || undefined,
    };
  }
}
