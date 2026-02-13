import { IsOptional, IsString, IsIn } from 'class-validator';

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsIn(['APARTMENT', 'HOUSE', 'OFFICE', 'STORAGE', 'PARKING'])
  unitType?: string;

  @IsOptional()
  @IsIn(['UNKNOWN', 'VACANT', 'OCCUPIED'])
  occupancyStatus?: string;
}
