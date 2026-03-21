import { IsString, IsOptional, MaxLength, IsDateString } from 'class-validator';

/**
 * Update Work Order DTO
 *
 * PATCH /buildings/:buildingId/work-orders/:workOrderId
 */
export class UpdateWorkOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;

  @IsOptional()
  @IsString()
  vendorId?: string | null;

  @IsOptional()
  @IsString()
  assignedToMembershipId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string | null;
}
