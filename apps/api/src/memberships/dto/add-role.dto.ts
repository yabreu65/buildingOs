import { IsEmpty, IsIn, IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import type { Role } from '@prisma/client';

const ROLE_VALUES: readonly Role[] = [
  'SUPER_ADMIN',
  'TENANT_OWNER',
  'TENANT_ADMIN',
  'OPERATOR',
  'RESIDENT',
];

export enum ScopeTypeDto {
  TENANT = 'TENANT',
  BUILDING = 'BUILDING',
  UNIT = 'UNIT',
}

export class AddRoleDto {
  @IsIn(ROLE_VALUES)
  role!: Role;

  @IsIn(Object.values(ScopeTypeDto))
  scopeType!: ScopeTypeDto;

  @ValidateIf((dto: AddRoleDto) => dto.scopeType === ScopeTypeDto.BUILDING)
  @IsString()
  @IsNotEmpty()
  @ValidateIf((dto: AddRoleDto) => dto.scopeType !== ScopeTypeDto.BUILDING)
  @IsEmpty()
  scopeBuildingId?: string;

  @ValidateIf((dto: AddRoleDto) => dto.scopeType === ScopeTypeDto.UNIT)
  @IsString()
  @IsNotEmpty()
  @ValidateIf((dto: AddRoleDto) => dto.scopeType !== ScopeTypeDto.UNIT)
  @IsEmpty()
  scopeUnitId?: string;
}
