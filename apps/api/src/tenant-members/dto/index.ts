import { IsString, IsEmail, IsOptional, IsIn } from 'class-validator';

export class CreateTenantMemberDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsIn(['RESIDENT', 'OPERATOR', 'TENANT_ADMIN', 'TENANT_OWNER'])
  role?: string;

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
  force?: boolean;
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
