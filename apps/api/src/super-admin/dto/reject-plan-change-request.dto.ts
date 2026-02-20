import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectPlanChangeRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
