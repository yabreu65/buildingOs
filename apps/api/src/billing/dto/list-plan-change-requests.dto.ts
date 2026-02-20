import { IsNotEmpty, IsString } from 'class-validator';

export class ListPlanChangeRequestsDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;
}
