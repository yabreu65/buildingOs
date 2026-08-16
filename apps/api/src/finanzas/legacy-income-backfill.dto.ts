import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { IncomeDestination } from '@prisma/client';

/**
 * FIN-04R: validación runtime de los endpoints de backfill legacy.
 */

export class LegacyBackfillPreviewQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'period must be in YYYY-MM format' })
  period?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @IsOptional()
  @IsEnum(IncomeDestination)
  destination?: IncomeDestination;
}

export class LegacyBackfillApplyItemDto {
  @IsString()
  @IsNotEmpty()
  incomeId!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fundId?: string | null;
}

export class LegacyBackfillApplyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LegacyBackfillApplyItemDto)
  items!: LegacyBackfillApplyItemDto[];
}
