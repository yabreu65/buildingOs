import { IsString, IsOptional, IsIn } from 'class-validator';

export class CreateUnitDto {
  @IsString()
  code: string;

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
