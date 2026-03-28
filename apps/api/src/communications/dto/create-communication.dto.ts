import {
  IsString,
  IsEnum,
  IsArray,
  ValidateNested,
  IsOptional,
  MinLength,
  ArrayMinSize,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CommunicationChannel, CommunicationStatus, CommunicationTargetType } from '@prisma/client';
import { BuildingCommunicationParamDto, BuildingParamDto } from '../../common/dtos/params.dto';

export class CreateCommunicationTargetDto {
  @IsEnum(CommunicationTargetType)
  targetType!: CommunicationTargetType;

  @IsOptional()
  @IsString()
  targetId?: string;
}

export class CreateCommunicationDto {
  @IsString()
  @MinLength(3)
  title!: string;

  @IsString()
  @MinLength(3)
  body!: string;

  @IsEnum(CommunicationChannel)
  channel!: CommunicationChannel;

  @IsOptional()
  @IsString()
  buildingId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCommunicationTargetDto)
  targets!: CreateCommunicationTargetDto[];
}

// ============================================================================
// QUERY DTOs
// ============================================================================

export class ListCommunicationsQueryDto {
  @IsOptional()
  @IsEnum(CommunicationStatus)
  status?: CommunicationStatus;

  @IsOptional()
  @IsEnum(CommunicationChannel)
  channel?: CommunicationChannel;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['createdAt', 'sentAt', 'scheduledAt'])
  sortBy?: 'createdAt' | 'sentAt' | 'scheduledAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// PARAM DTOs
// ============================================================================

export class GetCommunicationParamDto extends BuildingCommunicationParamDto {}
export class UpdateCommunicationParamDto extends BuildingCommunicationParamDto {}
export class DeleteCommunicationParamDto extends BuildingCommunicationParamDto {}
export class SendCommunicationParamDto extends BuildingCommunicationParamDto {}
export class ListCommunicationsParamDto extends BuildingParamDto {}
