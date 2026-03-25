import { IsOptional, IsString, IsIn, IsNumber, Min } from 'class-validator';

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

  @IsOptional()
  @IsNumber()
  @Min(0)
  m2?: number;

  @IsOptional()
  @IsString()
  unitCategoryId?: string | null;
}
