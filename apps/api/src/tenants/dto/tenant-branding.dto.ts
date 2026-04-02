/**
 * Tenant Branding & Configuration DTOs
 */

export class TenantBrandingResponseDto {
  tenantId!: string;
  tenantName!: string;
  brandName?: string | null;
  logoFileId?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  theme?: string | null;
  emailFooter?: string | null;
  currency!: string;
  locale!: string;
}

export class UpdateTenantBrandingDto {
  brandName?: string;
  logoFileId?: string;
  primaryColor?: string;
  secondaryColor?: string;
  theme?: string;
  emailFooter?: string;
  currency?: string;
  locale?: string;
}
