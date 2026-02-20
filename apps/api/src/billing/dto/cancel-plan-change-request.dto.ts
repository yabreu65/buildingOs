import { IsNotEmpty, IsString } from 'class-validator';

export class CancelPlanChangeRequestDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;
}
