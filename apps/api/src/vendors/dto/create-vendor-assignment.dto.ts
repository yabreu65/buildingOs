import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * Create Vendor Assignment DTO
 *
 * POST /buildings/:buildingId/vendors/assignments
 */
export class CreateVendorAssignmentDto {
  @IsString()
  @IsNotEmpty()
  vendorId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  serviceType!: string;
}
