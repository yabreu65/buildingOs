import { Type } from 'class-transformer';
import { IsIn, IsNumberString, IsOptional, IsString, Max, Min } from 'class-validator';
import { ONBOARDING_IMPORT_ISSUE_PAGE_SIZE_MAX, ONBOARDING_IMPORT_SHEETS } from '../onboarding-imports.constants';
import type { ImportIssueSeverity } from '@prisma/client';

const IMPORT_ISSUE_SHEETS = Object.values(ONBOARDING_IMPORT_SHEETS);
const IMPORT_ISSUE_SEVERITIES: ImportIssueSeverity[] = ['BLOCKER', 'WARNING', 'INFO'];

export class ImportIssueQueryDto {
  @IsOptional()
  @IsIn(IMPORT_ISSUE_SEVERITIES)
  severity?: ImportIssueSeverity;

  @IsOptional()
  @IsIn(IMPORT_ISSUE_SHEETS)
  sheet?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsNumberString()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsNumberString()
  @Type(() => Number)
  @Min(1)
  @Max(ONBOARDING_IMPORT_ISSUE_PAGE_SIZE_MAX)
  pageSize?: number = 25;
}
