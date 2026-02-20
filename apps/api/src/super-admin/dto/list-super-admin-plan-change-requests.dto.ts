import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListSuperAdminPlanChangeRequestsDto {
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';
}
