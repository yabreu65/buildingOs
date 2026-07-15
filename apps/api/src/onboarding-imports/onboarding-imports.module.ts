import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { OnboardingImportsController } from './onboarding-imports.controller';
import { OnboardingImportsService } from './onboarding-imports.service';
import { OnboardingImportConfirmationService } from './services/onboarding-import-confirmation.service';
import { OnboardingImportNormalizerService } from './services/onboarding-import-normalizer.service';
import { OnboardingImportParserService } from './services/onboarding-import-parser.service';
import { OnboardingImportTemplateService } from './services/onboarding-import-template.service';

@Module({
  imports: [PrismaModule, StorageModule, AuditModule],
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
