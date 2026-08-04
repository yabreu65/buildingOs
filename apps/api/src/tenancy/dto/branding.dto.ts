import { Transform } from 'class-transformer';
import {
  IsString,
  IsHexColor,
  IsOptional,
  IsIn,
  MaxLength,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Get tenant branding response
 */
export class GetBrandingResponseDto {
  tenantId!: string;
  tenantName!: string;
  brandName?: string;
  logoFileId?: string | null; // File ID stored; frontend generates presigned URL on-demand
  logoUrl?: string; // Deprecated: use logoFileId instead
  primaryColor?: string;
  secondaryColor?: string;
  theme?: string;
  emailFooter?: string;
  currency?: string; // ARS, VES, USD
  locale?: string; // es-AR, es-VE, en-US
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
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  logoFileId?: string | null; // null removes the logo, string must belong to same tenant

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

  @IsOptional()
  @IsIn(['ARS', 'VES', 'USD'])
  currency?: string;

  @IsOptional()
  @IsIn(['es-AR', 'es-VE', 'en-US'])
  locale?: string;
}
