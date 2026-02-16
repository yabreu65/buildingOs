import { IsString, IsEnum, IsOptional, MinLength } from 'class-validator';
import { CommunicationChannel } from '@prisma/client';

export class UpdateCommunicationDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  body?: string;

  @IsOptional()
  @IsEnum(CommunicationChannel)
  channel?: CommunicationChannel;
}
