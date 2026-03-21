import { IsString, IsOptional, MaxLength, IsDateString } from 'class-validator';

/**
 * Create Work Order DTO
 *
 * POST /buildings/:buildingId/work-orders
 */
export class CreateWorkOrderDto {
  @IsOptional()
  @IsString()
  ticketId?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  assignedToMembershipId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}
