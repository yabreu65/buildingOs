import { IsString, IsOptional, MinLength } from 'class-validator';

export class UpdateBuildingDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  address?: string;

  // Alias is immutable for MVP — not editable
  // @IsOptional()
  // @IsString()
  // alias?: string;
}
