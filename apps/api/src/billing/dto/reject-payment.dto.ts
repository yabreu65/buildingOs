import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * Reject Payment DTO
 *
 * POST /admin/payments/:id/reject
 */
export class RejectPaymentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
