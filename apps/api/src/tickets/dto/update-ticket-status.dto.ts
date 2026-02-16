import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { TicketStatus } from '@prisma/client';

/**
 * DTO for changing ticket status
 *
 * Valid transitions:
 * - OPEN → IN_PROGRESS
 * - IN_PROGRESS → RESOLVED
 * - RESOLVED → CLOSED
 * - CLOSED → OPEN (reopen with optional reason)
 */
export class UpdateTicketStatusDto {
  @IsEnum(TicketStatus)
  status: TicketStatus;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string; // Required when reopening (status = OPEN from CLOSED)
}
