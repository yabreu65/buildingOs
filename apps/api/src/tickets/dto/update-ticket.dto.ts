import { IsString, IsOptional, IsEnum, Length } from 'class-validator';
import { TicketPriority, TicketStatus } from '@prisma/client';

export class UpdateTicketDto {
  @IsOptional()
  @IsString()
  @Length(3, 255)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(5, 2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  category?: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsString()
  unitId?: string | null; // Can set to null to remove unit association

  @IsOptional()
  @IsString()
  assignedToMembershipId?: string | null; // Can set to null to unassign
}
