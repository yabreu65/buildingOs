import { IsString, IsOptional, MinLength } from 'class-validator';

export class UpdateBuildingDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
