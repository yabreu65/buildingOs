import { IsString, IsNotEmpty } from 'class-validator';

export class StartImpersonationDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;
}
