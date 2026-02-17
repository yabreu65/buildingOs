import { IsString, IsHexColor, IsOptional, IsIn, MaxLength } from 'class-validator';

/**
 * Get tenant branding response
 */
export class GetBrandingResponseDto {
  tenantId: string;
  tenantName: string;
  brandName?: string;
  logoFileId?: string; // File ID stored; frontend generates presigned URL on-demand
  logoUrl?: string; // Deprecated: use logoFileId instead
  primaryColor?: string;
  secondaryColor?: string;
  theme?: string;
  emailFooter?: string;
}

/**
 * Update tenant branding request
 */
export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brandName?: string;

  @IsOptional()
  @IsString()
  logoFileId?: string; // Must belong to same tenant

  @IsOptional()
  @IsHexColor()
  primaryColor?: string; // Hex color validation

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @IsOptional()
  @IsIn(['light', 'dark', 'system'])
  theme?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  emailFooter?: string;
}
