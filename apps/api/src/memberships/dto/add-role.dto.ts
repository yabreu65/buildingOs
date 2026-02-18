import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';

export enum ScopeTypeDto {
  TENANT = 'TENANT',
  BUILDING = 'BUILDING',
  UNIT = 'UNIT',
}

export class AddRoleDto {
  @IsEnum(Role)
  role: Role;

  @IsEnum(ScopeTypeDto)
  scopeType: ScopeTypeDto;

  @IsOptional()
  @IsString()
  scopeBuildingId?: string;

  @IsOptional()
  @IsString()
  scopeUnitId?: string;
}
