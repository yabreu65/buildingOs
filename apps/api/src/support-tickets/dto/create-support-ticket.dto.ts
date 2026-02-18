import { IsString, IsNotEmpty, IsEnum, MinLength, MaxLength } from 'class-validator';

export enum SupportTicketCategory {
  BILLING = 'BILLING',
  FEATURE_REQUEST = 'FEATURE_REQUEST',
  BUG_REPORT = 'BUG_REPORT',
  ACCOUNT_ISSUE = 'ACCOUNT_ISSUE',
  TECHNICAL_SUPPORT = 'TECHNICAL_SUPPORT',
  OTHER = 'OTHER',
}

export enum SupportTicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export class CreateSupportTicketDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5, { message: 'Title must be at least 5 characters' })
  @MaxLength(200, { message: 'Title must not exceed 200 characters' })
  title: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Description must be at least 10 characters' })
  @MaxLength(5000, { message: 'Description must not exceed 5000 characters' })
  description: string;

  @IsEnum(SupportTicketCategory)
  category: SupportTicketCategory = SupportTicketCategory.OTHER;

  @IsEnum(SupportTicketPriority)
  priority: SupportTicketPriority = SupportTicketPriority.MEDIUM;
}
