import { IsString, MinLength, IsOptional } from 'class-validator';

export class AcceptInvitationDto {
  @IsString()
  @MinLength(10)
  token: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
