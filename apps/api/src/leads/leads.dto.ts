import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Min, MaxLength, IsBoolean } from 'class-validator';
import { TenantType } from '@prisma/client';

export class CreateLeadDto {
  @IsString()
  @MaxLength(100)
  fullName: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneWhatsapp?: string;

  @IsEnum(TenantType)
  tenantType: TenantType;

  @IsOptional()
  @IsInt()
  @Min(1)
  buildingsCount?: number;

  @IsInt()
  @Min(1)
  unitsEstimate: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  countryCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @IsOptional()
  @IsString()
  source?: string; // "pricing-page", "contact-form", etc.
}

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  status?: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'DISQUALIFIED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ConvertLeadDto {
  @IsString()
  @MaxLength(100)
  tenantName: string;

  @IsOptional()
  @IsEnum(TenantType)
  tenantType?: TenantType;

  @IsOptional()
  @IsEmail()
  ownerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ownerFullName?: string;

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsBoolean()
  createDemoData?: boolean = true;
}

export class ConvertLeadResponseDto {
  tenantId: string;
  ownerUserId: string;
  inviteSent: boolean;
}

export class LeadResponseDto {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  tenantType: string;
  buildingsCount?: number;
  unitsEstimate: number;
  location?: string;
  message?: string;
  source?: string;
  status: string;
  contactedAt?: Date;
  notes?: string;
  convertedTenantId?: string;
  convertedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
