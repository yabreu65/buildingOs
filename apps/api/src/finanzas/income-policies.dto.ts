import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IncomeApplicationDestination, IncomePolicyVersionStatus } from '@prisma/client';

export const MAX_POLICY_RULES = 20;

export class IncomePolicyRuleInputDto {
  @IsEnum(IncomeApplicationDestination)
  destinationType!: IncomeApplicationDestination;

  @IsString()
  @IsOptional()
  fundId?: string;

  /** Basis points: 100% = 10000 bp. */
  @IsInt()
  @Min(1)
  @Max(10000)
  percentageBasisPoints!: number;
}

export class CreateIncomePolicyDto {
  @IsString()
  categoryId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_POLICY_RULES)
  @ValidateNested({ each: true })
  @Type(() => IncomePolicyRuleInputDto)
  rules!: IncomePolicyRuleInputDto[];
}

export class CreateIncomePolicyVersionDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_POLICY_RULES)
  @ValidateNested({ each: true })
  @Type(() => IncomePolicyRuleInputDto)
  rules!: IncomePolicyRuleInputDto[];
}

export interface IncomePolicyRuleResponseDto {
  id: string;
  destinationType: IncomeApplicationDestination;
  fundId: string | null;
  percentageBasisPoints: number;
}

export interface IncomePolicyVersionResponseDto {
  id: string;
  version: number;
  status: IncomePolicyVersionStatus;
  rules: IncomePolicyRuleResponseDto[];
  createdAt: Date;
}

export interface IncomePolicyResponseDto {
  id: string;
  tenantId: string;
  categoryId: string;
  currentVersion: IncomePolicyVersionResponseDto | null;
  versions: IncomePolicyVersionResponseDto[];
}
