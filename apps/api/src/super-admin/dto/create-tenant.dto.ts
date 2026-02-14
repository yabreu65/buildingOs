import { IsString, IsEnum, MinLength, MaxLength } from 'class-validator';
import { TenantType } from '@prisma/client';

export class CreateTenantDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  name: string;

  @IsEnum(TenantType)
  type: TenantType;
}
