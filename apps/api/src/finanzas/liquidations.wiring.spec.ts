import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { FinanzasModule } from './finanzas.module';
import { FinanzasValidators } from './finanzas.validators';
import {
  createLiquidationWorkflowDependencies,
  LiquidationPublicationUseCase,
} from './liquidation-publication.use-case';
import { LiquidationsService } from './liquidations.service';

describe('FinanzasModule wiring', () => {
  it('registers LiquidationPublicationUseCase in module metadata and resolves the same Nest-managed instance inside LiquidationsService', async () => {
    const providersMetadata = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      FinanzasModule,
    ) as unknown[];

    expect(Array.isArray(providersMetadata)).toBe(true);
    expect(providersMetadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: LiquidationPublicationUseCase }),
        LiquidationsService,
      ]),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: PrismaService,
          useValue: {
            membership: { findFirst: jest.fn() },
            liquidation: { findFirst: jest.fn(), create: jest.fn() },
            charge: { findMany: jest.fn() },
            unit: { findMany: jest.fn(), findFirst: jest.fn() },
            $transaction: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            createLog: jest.fn(),
            createLogRequired: jest.fn(),
          },
        },
        {
          provide: FinanzasValidators,
          useValue: {
            isAdminOrOperator: jest.fn().mockReturnValue(true),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            createNotification: jest.fn(),
          },
        },
        {
          provide: LiquidationPublicationUseCase,
          inject: [PrismaService, AuditService, FinanzasValidators, NotificationsService],
          useFactory: (
            prisma: PrismaService,
            auditService: AuditService,
            validators: FinanzasValidators,
            notificationsService: NotificationsService,
          ) =>
            new LiquidationPublicationUseCase(
              createLiquidationWorkflowDependencies({
                prisma,
                auditService,
                validators,
                notificationsService,
              }),
            ),
        },
        LiquidationsService,
      ],
    }).compile();

    const service = moduleRef.get(LiquidationsService);
    const useCase = moduleRef.get(LiquidationPublicationUseCase);

    expect(service).toBeInstanceOf(LiquidationsService);
    expect(useCase).toBeInstanceOf(LiquidationPublicationUseCase);
    expect(
      (service as unknown as { publicationUseCase: LiquidationPublicationUseCase })
        .publicationUseCase,
    ).toBe(useCase);
  });
});
