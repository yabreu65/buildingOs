import { IsOptional, IsDateString } from 'class-validator';

export class ScheduleCommunicationDto {
  @IsOptional()
  @IsDateString()
  scheduledAt?: Date;
}
