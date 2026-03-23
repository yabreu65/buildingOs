import { IsString, IsOptional, IsEnum, Length } from 'class-validator';
import { TicketPriority, TicketCategory } from '@prisma/client';

export class CreateTicketDto {
  @IsString()
  @Length(3, 255)
  title!: string;

  @IsString()
  @Length(5, 2000)
  description!: string;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory; // AI will suggest if not provided

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority; // LOW, MEDIUM, HIGH, URGENT (AI will suggest if not provided)

  @IsOptional()
  @IsString()
  unitId?: string; // Optional: ticket may be building-wide

  @IsOptional()
  @IsString()
  assignedToMembershipId?: string; // Optional: ticket may not be assigned immediately
}
