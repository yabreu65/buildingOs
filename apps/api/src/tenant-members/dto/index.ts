import { Transform } from 'class-transformer';
import {
  IsString,
  IsEmail,
  IsOptional,
  IsIn,
  IsBoolean,
  IsNotEmpty,
  MinLength,
} from 'class-validator';
import type { MemberStatus, Role } from '@prisma/client';

const ROLE_VALUES: readonly Role[] = [
  'SUPER_ADMIN',
  'TENANT_OWNER',
  'TENANT_ADMIN',
  'OPERATOR',
  'RESIDENT',
];

const MEMBER_STATUS_VALUES: readonly MemberStatus[] = [
  'DRAFT',
  'PENDING_INVITE',
  'ACTIVE',
  'DISABLED',
];

export class CreateTenantMemberDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsOptional()
  @IsIn(ROLE_VALUES)
  role?: Role;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateTenantMemberDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class InviteTenantMemberDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class ListTenantMembersQueryDto {
  @IsOptional()
  @IsIn(MEMBER_STATUS_VALUES)
  status?: MemberStatus;
}

export class AssignableResidentsQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  unitId?: string;
}

export class AcceptInvitationDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  fullName?: string;
}
