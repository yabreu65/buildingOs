import { Module } from '@nestjs/common';

import { AppConfigModule } from '../config/app-config.module';
import { DatabaseModule } from '../database/database.module';
import { MinioModule } from '../storage/minio.module';
import { OnboardingImportsController } from './onboarding-imports.controller';
import { OnboardingImportsService } from './onboarding-imports.service';
import { OnboardingImportConfirmationService } from './services/onboarding-import-confirmation.service';
import { OnboardingImportNormalizerService } from './services/onboarding-import-normalizer.service';
import { OnboardingImportParserService } from './services/onboarding-import-parser.service';
import { OnboardingImportTemplateService } from './services/onboarding-import-template.service';

@Module({
  imports: [AppConfigModule, DatabaseModule, MinioModule],
  controllers: [OnboardingImportsController],
  providers: [
    OnboardingImportsService,
    OnboardingImportConfirmationService,
    OnboardingImportNormalizerService,
    OnboardingImportParserService,
    OnboardingImportTemplateService,
  ],
  exports: [OnboardingImportsService],
})
export class OnboardingImportsModule {}
