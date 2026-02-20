import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePlanChangeRequestDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsString()
  @IsNotEmpty()
  requestedPlanId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
