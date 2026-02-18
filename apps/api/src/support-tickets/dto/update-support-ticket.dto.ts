import { IsString, IsOptional, IsEnum } from 'class-validator';
import { SupportTicketPriority } from './create-support-ticket.dto';

export enum UpdateSupportTicketStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export class UpdateSupportTicketDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(UpdateSupportTicketStatus)
  @IsOptional()
  status?: UpdateSupportTicketStatus;

  @IsEnum(SupportTicketPriority)
  @IsOptional()
  priority?: SupportTicketPriority;
}

export class AddSupportTicketCommentDto {
  @IsString()
  body: string;
}

export class AssignSupportTicketDto {
  @IsString()
  @IsOptional()
  assignedToUserId?: string;
}
