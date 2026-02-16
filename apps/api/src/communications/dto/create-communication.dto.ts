import {
  IsString,
  IsEnum,
  IsArray,
  ValidateNested,
  IsOptional,
  MinLength,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CommunicationChannel, CommunicationTargetType } from '@prisma/client';

export class CreateCommunicationTargetDto {
  @IsEnum(CommunicationTargetType)
  targetType: CommunicationTargetType;

  @IsOptional()
  @IsString()
  targetId?: string | null;
}

export class CreateCommunicationDto {
  @IsString()
  @MinLength(3)
  title: string;

  @IsString()
  @MinLength(3)
  body: string;

  @IsEnum(CommunicationChannel)
  channel: CommunicationChannel;

  @IsOptional()
  @IsString()
  buildingId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCommunicationTargetDto)
  targets: CreateCommunicationTargetDto[];
}
