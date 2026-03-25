import { IsString, IsOptional, IsNumber, IsBoolean, IsPositive, Min } from 'class-validator';
import { BuildingParamDto } from '../common/dtos/params.dto';

// ============================================================================
// UNIT CATEGORY DTOs
// ============================================================================

export class CreateUnitCategoryDto {
  @IsString()
  name!: string;

  @IsNumber()
  @IsPositive()
  minM2!: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxM2?: number; // null allowed in schema = catch-all

  @IsNumber()
  @IsPositive()
  coefficient!: number; // Factor de prorrateo
}

export class UpdateUnitCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  minM2?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxM2?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  coefficient?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AutoAssignUnitsDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean; // If true, overwrite existing assignments
}

export class AutoAssignPreviewDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

// ============================================================================
// RESPONSE DTOs
// ============================================================================

export interface UnitCategoryDto {
  id: string;
  tenantId: string;
  buildingId: string;
  name: string;
  minM2: number;
  maxM2: number | null;
  coefficient: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutoAssignResultDto {
  assigned: number;
  unassigned: Array<{
    id: string;
    code: string;
    label: string | null;
    m2: number | null;
  }>;
  noM2: Array<{
    id: string;
    code: string;
    label: string | null;
  }>;
  alreadyAssigned: number;
}

// ============================================================================
// PARAM DTOs
// ============================================================================

export class CreateUnitCategoryParamDto extends BuildingParamDto {}
export class ListUnitCategoriesParamDto extends BuildingParamDto {}
export class GetUnitCategoryParamDto extends BuildingParamDto {
  @IsString()
  categoryId!: string;
}
export class UpdateUnitCategoryParamDto extends BuildingParamDto {
  @IsString()
  categoryId!: string;
}
export class DeleteUnitCategoryParamDto extends BuildingParamDto {
  @IsString()
  categoryId!: string;
}
export class AutoAssignUnitsParamDto extends BuildingParamDto {}
export class AutoAssignPreviewParamDto extends BuildingParamDto {}
