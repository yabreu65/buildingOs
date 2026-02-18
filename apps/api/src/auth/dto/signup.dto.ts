import { IsEmail, IsNotEmpty, MinLength, MaxLength, IsOptional, IsEnum, IsString, Matches } from 'class-validator';

export enum TenantTypeEnum {
  ADMINISTRADORA = 'ADMINISTRADORA',
  EDIFICIO_AUTOGESTION = 'EDIFICIO_AUTOGESTION',
}

/**
 * Signup DTO with security validation
 * - Email: standard format with length limits
 * - Password: strong requirements (8+ chars)
 * - Name: length limits to prevent abuse
 * - TenantName: optional, length limits
 */
export class SignupDto {
  @IsEmail({}, { message: 'Email must be valid' })
  @IsString()
  @MaxLength(255)
  email: string;

  @IsNotEmpty({ message: 'Full name is required' })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(255, { message: 'Name must not exceed 255 characters' })
  name: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(255, { message: 'Password must not exceed 255 characters' })
  password: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Tenant name must be at least 2 characters' })
  @MaxLength(255, { message: 'Tenant name must not exceed 255 characters' })
  tenantName?: string;

  @IsOptional()
  @IsEnum(TenantTypeEnum, { message: 'Invalid tenant type' })
  tenantType?: TenantTypeEnum;
}
