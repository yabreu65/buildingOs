import { IsOptional, IsString } from 'class-validator';

export class ImportCountryVendorDto {
  @IsString()
  sourceVendorId!: string;

  @IsOptional()
  @IsString()
  assignBuildingId?: string;

  @IsOptional()
  @IsString()
  serviceType?: string;
}
