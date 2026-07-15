import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentTenantId } from '../auth/current-tenant-id.decorator';
import { TenantId } from '../types/request-context.type';
import { ConfirmOnboardingImportDto } from './dto/confirm-onboarding-import.dto';
import { ImportIssueQueryDto } from './dto/import-issue-query.dto';
import { ImportJobResponseDto } from './dto/import-job-response.dto';
import { ImportPreviewResponseDto } from './dto/import-preview-response.dto';
import { OnboardingImportsService } from './onboarding-imports.service';

@Controller('tenants/:tenantId/onboarding-imports')
export class OnboardingImportsController {
  constructor(private readonly onboardingImportsService: OnboardingImportsService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  async preview(
    @TenantId() tenantId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ImportPreviewResponseDto> {
    return this.onboardingImportsService.preview({ tenantId, file });
  }

  @Post(':importJobId/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @TenantId() tenantId: string,
    @Param('importJobId') importJobId: string,
    @Query() query: ConfirmOnboardingImportDto,
  ): Promise<ImportJobResponseDto> {
    return this.onboardingImportsService.confirm({ tenantId, importJobId, dryRun: query.dryRun });
  }

  @Get(':importJobId/issues')
  async listIssues(
    @TenantId() tenantId: string,
    @Param('importJobId') importJobId: string,
    @Query() query: ImportIssueQueryDto,
  ): Promise<ImportPreviewResponseDto> {
    return this.onboardingImportsService.listIssues({
      tenantId,
      importJobId,
      limit: query.limit,
      offset: query.offset,
    });
  }
}
