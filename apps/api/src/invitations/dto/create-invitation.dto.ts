import { IsEmail, IsArray, IsIn, ArrayMinSize } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsArray()
  @IsIn(['TENANT_ADMIN', 'OPERATOR', 'RESIDENT'], { each: true })
  @ArrayMinSize(1)
  roles: string[];
}
