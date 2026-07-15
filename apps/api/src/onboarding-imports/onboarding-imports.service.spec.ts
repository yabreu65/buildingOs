import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AppConfigModule } from '../config/app-config.module';
import { ConfigService } from '../config/config.service';
import { DatabaseService } from '../database/database.service';
import { MinioService } from '../storage/minio.service';
import { OnboardingImportsService } from './onboarding-imports.service';
import { OnboardingImportConfirmationService } from './services/onboarding-import-confirmation.service';
import { OnboardingImportNormalizerService } from './services/onboarding-import-normalizer.service';
import { OnboardingImportParserService } from './services/onboarding-import-parser.service';
import { OnboardingImportTemplateService } from './services/onboarding-import-template.service';

const prismaMock = {
  onboardingImportJob: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  tenant: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};

const minioServiceMock = {
  uploadObject: jest.fn(),
  getObjectUrl: jest.fn(),
  removeObject: jest.fn(),
};

describe('OnboardingImportsService', () => {
  let service: OnboardingImportsService;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [
        OnboardingImportsService,
        OnboardingImportConfirmationService,
        OnboardingImportNormalizerService,
        OnboardingImportParserService,
        OnboardingImportTemplateService,
        {
          provide: DatabaseService,
          useValue: prismaMock,
        },
        {
          provide: MinioService,
          useValue: minioServiceMock,
        },
      ],
    }).compile();

    service = module.get<OnboardingImportsService>(OnboardingImportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws when tenant is missing', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);

    await expect(
      service.preview({ tenantId: 'tenant-1', file: undefined as unknown as Express.Multer.File }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when import job is missing', async () => {
    prismaMock.onboardingImportJob.findUnique.mockResolvedValue(null);

    await expect(
      service.confirm({ tenantId: 'tenant-1', importJobId: 'import-job-1', dryRun: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
