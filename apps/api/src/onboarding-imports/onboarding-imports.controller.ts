import {
  Controller,
  Body,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingImportsService } from './onboarding-imports.service';
import { ImportIssueQueryDto } from './dto/import-issue-query.dto';
import { ConfirmOnboardingImportDto } from './dto/confirm-onboarding-import.dto';
import { ONBOARDING_IMPORT_MAX_FILE_SIZE_BYTES } from './onboarding-imports.constants';
import type { AuthenticatedRequest } from '../common/types/request.types';
import type { UploadableSpreadsheetFile } from './types/onboarding-import.types';

@Controller('tenants/:tenantId/onboarding-imports')
@UseGuards(JwtAuthGuard)
export class OnboardingImportsController {
  constructor(private readonly onboardingImportsService: OnboardingImportsService) {}

  @Get('template')
  async downloadTemplate(
    @Param('tenantId') tenantId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.onboardingImportsService.getTemplate({
      tenantId,
      user: request.user,
    });

    response.status(HttpStatus.OK);
    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    response.setHeader('Content-Length', result.buffer.length);
    response.send(result.buffer);
  }

  @Post('preview')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: ONBOARDING_IMPORT_MAX_FILE_SIZE_BYTES,
        files: 1,
      },
    }),
  )
  async previewImport(
    @Param('tenantId') tenantId: string,
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadableSpreadsheetFile | undefined,
  ) {
    return this.onboardingImportsService.previewImport(
      {
        tenantId,
        user: request.user,
      },
      file,
    );
  }

  @Get(':importId')
  async getImport(
    @Param('tenantId') tenantId: string,
    @Param('importId') importId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.onboardingImportsService.getImport({
      tenantId,
      user: request.user,
      importId,
    });
  }

  @Get(':importId/issues')
  async listIssues(
    @Param('tenantId') tenantId: string,
    @Param('importId') importId: string,
    @Req() request: AuthenticatedRequest,
    @Query() query: ImportIssueQueryDto,
  ) {
    return this.onboardingImportsService.listIssues(
      {
        tenantId,
        user: request.user,
        importId,
      },
      {
        severity: query.severity,
        sheet: query.sheet,
        code: query.code,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 25,
      },
    );
  }

  @Post(':importId/confirm')
  async confirmImport(
    @Param('tenantId') tenantId: string,
    @Param('importId') importId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: ConfirmOnboardingImportDto,
  ) {
    return this.onboardingImportsService.confirmImport(
      {
        tenantId,
        user: request.user,
        importId,
      },
      body,
    );
  }
}
