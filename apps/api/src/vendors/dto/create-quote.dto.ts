import { IsString, IsNumber, IsOptional, MaxLength, Min, IsNotEmpty } from 'class-validator';

/**
 * Create Quote DTO
 *
 * POST /buildings/:buildingId/quotes
 */
export class CreateQuoteDto {
  @IsString()
  @IsNotEmpty()
  vendorId!: string;

  @IsOptional()
  @IsString()
  ticketId?: string;

  @IsNumber()
  @Min(0)
  amount!: number;

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
  fileId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
