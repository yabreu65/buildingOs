import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class UpdateTenantDto {
  @IsString()
  @IsOptional()
  @MinLength(3)
  @MaxLength(255)
  name?: string;
}
