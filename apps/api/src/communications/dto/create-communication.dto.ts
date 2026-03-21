import {
  IsString,
  IsEnum,
  IsArray,
  ValidateNested,
  IsOptional,
  MinLength,
  ArrayMinSize,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CommunicationChannel, CommunicationTargetType } from '@prisma/client';
import { BuildingCommunicationParamDto } from '../../common/dtos/params.dto';

export class CreateCommunicationTargetDto {
  @IsEnum(CommunicationTargetType)
  targetType!: CommunicationTargetType;

  @IsOptional()
  @IsString()
  targetId?: string | null;
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
// PARAM DTOs
// ============================================================================

export class CreateCommunicationParamDto extends BuildingCommunicationParamDto {
  buildingId!: string;
}

export class GetCommunicationParamDto extends BuildingCommunicationParamDto {}
export class UpdateCommunicationParamDto extends BuildingCommunicationParamDto {}
export class DeleteCommunicationParamDto extends BuildingCommunicationParamDto {}
export class SendCommunicationParamDto extends BuildingCommunicationParamDto {}
export class ListCommunicationsParamDto {
  @IsUUID()
  buildingId!: string;
}
