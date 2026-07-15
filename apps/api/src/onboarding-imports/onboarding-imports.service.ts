import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, OnboardingImportStatus } from '@prisma/client';

import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import { MinioService } from '../storage/minio.service';
import { ConfirmOnboardingImportDto } from './dto/confirm-onboarding-import.dto';
import { ImportJobResponseDto } from './dto/import-job-response.dto';
import { ImportPreviewResponseDto, ImportPreviewRowDto } from './dto/import-preview-response.dto';
import { ONBOARDING_IMPORTS_ALLOWED_EXTENSIONS, ONBOARDING_IMPORTS_ALLOWED_MIME_TYPES, ONBOARDING_IMPORTS_MAX_PREVIEW_ROWS, ONBOARDING_IMPORTS_S3_BUCKET, ONBOARDING_IMPORTS_S3_PREFIX } from './onboarding-imports.constants';
import { OnboardingImportConfirmationService } from './services/onboarding-import-confirmation.service';
import { OnboardingImportNormalizerService } from './services/onboarding-import-normalizer.service';
import { OnboardingImportParserService } from './services/onboarding-import-parser.service';
import { OnboardingImportTemplateService } from './services/onboarding-import-template.service';
import { OnboardingImportInput, OnboardingImportIssue, OnboardingImportRow } from './types/onboarding-import.types';

@Injectable()
export class OnboardingImportsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly minioService: MinioService,
    private readonly appConfigService: AppConfigService,
    private readonly onboardingImportParserService: OnboardingImportParserService,
    private readonly onboardingImportNormalizerService: OnboardingImportNormalizerService,
    private readonly onboardingImportConfirmationService: OnboardingImportConfirmationService,
    private readonly onboardingImportTemplateService: OnboardingImportTemplateService,
  ) {}

  async preview({ tenantId, file }: { tenantId: string; file: Express.Multer.File }): Promise<ImportPreviewResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (!this.isAllowedFile(file)) {
      throw new UnprocessableEntityException('Invalid onboarding import file');
    }

    const tenant = await this.databaseService.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const parsed = await this.onboardingImportParserService.parse(file.buffer);
    const rows = parsed.map((row, index) => ({ ...row, index }));
    const normalized = this.onboardingImportNormalizerService.normalizeRows(rows);
    const issues = this.collectIssues(normalized);

    return {
      importJob: {
        id: `${tenantId}-preview`,
        tenantId,
        status: OnboardingImportStatus.PREVIEW,
        totalRows: normalized.length,
        validRows: normalized.filter((row) => row.issues.length === 0).length,
        issueCount: issues.length,
      },
      previewRows: normalized.slice(0, ONBOARDING_IMPORTS_MAX_PREVIEW_ROWS).map((row) => this.toPreviewRow(row)),
      issues: issues.slice(0, ONBOARDING_IMPORTS_MAX_PREVIEW_ROWS).map((issue) => this.toPreviewIssue(issue)),
      templateUrl: this.onboardingImportTemplateService.getTemplateUrl(),
    };
  }

  async confirm({ tenantId, importJobId, dryRun = false }: { tenantId: string; importJobId: string; dryRun?: boolean }): Promise<ImportJobResponseDto> {
    const importJob = await this.databaseService.onboardingImportJob.findUnique({
      where: { id: importJobId },
      include: {
        rows: {
          orderBy: { index: 'asc' },
        },
      },
    });

    if (!importJob || importJob.tenantId !== tenantId) {
      throw new NotFoundException('Import job not found');
    }

    if (importJob.status === OnboardingImportStatus.CONFIRMED && dryRun) {
      return this.toImportJobResponse(importJob);
    }

    if (importJob.status === OnboardingImportStatus.PREVIEW || importJob.status === OnboardingImportStatus.CONFIRMED) {
      const result = await this.onboardingImportConfirmationService.confirmImport({
        importJob,
        dryRun,
      });

      if (dryRun) {
        return this.toImportJobResponse(result);
      }

      const confirmed = await this.databaseService.onboardingImportJob.update({
        where: { id: importJob.id },
        data: {
          status: OnboardingImportStatus.CONFIRMED,
          confirmedAt: new Date(),
        },
        include: {
          rows: {
            orderBy: { index: 'asc' },
          },
        },
      });

      return this.toImportJobResponse(confirmed);
    }

    throw new UnprocessableEntityException('Import job cannot be confirmed in its current state');
  }

  async listIssues({ tenantId, importJobId, limit = ONBOARDING_IMPORTS_MAX_PREVIEW_ROWS, offset = 0 }: { tenantId: string; importJobId: string; limit?: number; offset?: number }): Promise<ImportPreviewResponseDto> {
    const importJob = await this.databaseService.onboardingImportJob.findUnique({
      where: { id: importJobId },
      include: {
        rows: {
          orderBy: { index: 'asc' },
        },
      },
    });

    if (!importJob || importJob.tenantId !== tenantId) {
      throw new NotFoundException('Import job not found');
    }

    const rows = importJob.rows.slice(offset, offset + limit).map((row) => ({
      ...row,
      issues: row.issues as unknown as OnboardingImportIssue[],
    }));

    return {
      importJob: this.toImportJobResponse(importJob).importJob,
      previewRows: rows.map((row) => this.toPreviewRow(row)),
      issues: rows.flatMap((row) => row.issues.map((issue) => this.toPreviewIssue(issue))),
      templateUrl: this.onboardingImportTemplateService.getTemplateUrl(),
    };
  }

  private isAllowedFile(file: Express.Multer.File): boolean {
    const extension = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    return ONBOARDING_IMPORTS_ALLOWED_EXTENSIONS.includes(extension as (typeof ONBOARDING_IMPORTS_ALLOWED_EXTENSIONS)[number])
      && ONBOARDING_IMPORTS_ALLOWED_MIME_TYPES.has(file.mimetype);
  }

  private collectIssues(rows: OnboardingImportRow[]): OnboardingImportIssue[] {
    return rows.flatMap((row) => row.issues);
  }

  private toPreviewRow(row: OnboardingImportRow & { index: number }): ImportPreviewRowDto {
    return {
      index: row.index,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      apartment: row.apartment,
      tower: row.tower,
      issues: row.issues,
    };
  }

  private toPreviewIssue(issue: OnboardingImportIssue): OnboardingImportIssue {
    return issue;
  }

  private toImportJobResponse(importJob: {
    id: string;
    tenantId: string;
    status: OnboardingImportStatus;
    totalRows: number;
    validRows: number;
    issueCount: number;
  } & { rows?: Array<{ index: number; issues: OnboardingImportIssue[] }> }): ImportJobResponseDto {
    return {
      importJob: {
        id: importJob.id,
        tenantId: importJob.tenantId,
        status: importJob.status,
        totalRows: importJob.totalRows,
        validRows: importJob.validRows,
        issueCount: importJob.issueCount,
      },
    };
  }
}
