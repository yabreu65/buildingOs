import { IsString, IsEnum, MinLength, MaxLength } from 'class-validator';
import { BillingPlanId, TenantType } from '@prisma/client';

export class CreateTenantDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  name!: string;

  @IsEnum(TenantType)
  type!: TenantType;

  @IsEnum(BillingPlanId)
  planId!: BillingPlanId;
}
