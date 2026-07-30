import { IsString, MinLength } from 'class-validator';

export class ValidateInvitationQueryDto {
  @IsString()
  @MinLength(10)
  token!: string;
}
