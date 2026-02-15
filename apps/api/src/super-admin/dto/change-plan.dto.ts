import { IsString, IsNotEmpty } from 'class-validator';
import { BillingPlanId } from '@prisma/client';

export class ChangePlanDto {
  @IsString()
  @IsNotEmpty()
  newPlanId: BillingPlanId;
}
