import { IsString, IsOptional, IsEnum, Length } from 'class-validator';
import { TicketPriority } from '@prisma/client';

export class CreateTicketDto {
  @IsString()
  @Length(3, 255)
  title: string;

  @IsString()
  @Length(5, 2000)
  description: string;

  @IsString()
  @Length(1, 100)
  category: string; // "MAINTENANCE", "REPAIR", "CLEANING", "COMPLAINT", etc.

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority; // LOW, MEDIUM, HIGH, URGENT

  @IsOptional()
  @IsString()
  unitId?: string; // Optional: ticket may be building-wide

  @IsOptional()
  @IsString()
  assignedToMembershipId?: string; // Optional: ticket may not be assigned immediately
}
