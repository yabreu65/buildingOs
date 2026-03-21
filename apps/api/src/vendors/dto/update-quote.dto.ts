import { IsString, IsNumber, IsOptional, MaxLength, Min } from 'class-validator';

/**
 * Update Quote DTO
 *
 * PATCH /buildings/:buildingId/quotes/:quoteId
 */
export class UpdateQuoteDto {
  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;

  @IsOptional()
  @IsString()
  fileId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}
