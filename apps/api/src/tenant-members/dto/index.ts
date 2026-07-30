import { IsString, IsEmail, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { MemberStatus, Role } from '@prisma/client';

export class CreateTenantMemberDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsEnum(Role)
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
  @IsEnum(MemberStatus)
  status?: MemberStatus;
}

export class AssignableResidentsQueryDto {
  @IsOptional()
  @IsString()
  unitId?: string;
}

export class AcceptInvitationDto {
  @IsString()
  token!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsString()
  fullName?: string;
}
