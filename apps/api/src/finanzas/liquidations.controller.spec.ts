import { Test } from '@nestjs/testing';
import { LiquidationsController } from './liquidations.controller';
import { LiquidationsService } from './liquidations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/request.types';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import type {
  CreateLiquidationDraftDto,
  CancelLiquidationDto,
  ListLiquidationsQueryDto,
  LiquidationParamDto,
  LiquidationDetailDto,
  LiquidationResponseDto,
  PublishLiquidationDto,
} from './expense-ledger.dto';

const stubReq = (
  overrides: Record<string, unknown> = {},
): AuthenticatedRequest =>
  ({
    tenantId: 'tenant-1',
    user: {
      id: 'user-1',
      email: 'admin@test.com',
      membershipId: 'member-legacy',
      tenantId: 'tenant-1',
      effectiveMembership: {
        id: 'member-effective',
        tenantId: 'tenant-1',
        roles: ['TENANT_ADMIN'],
      },
      roles: ['TENANT_ADMIN'],
    },
    ...overrides,
  }) as AuthenticatedRequest;

describe('LiquidationsController', () => {
  let controller: LiquidationsController;
  let service: {
    listLiquidations: jest.Mock;
    getLiquidation: jest.Mock;
    createDraft: jest.Mock;
    reviewLiquidation: jest.Mock;
    publishLiquidation: jest.Mock;
    cancelLiquidation: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listLiquidations: jest.fn(),
      getLiquidation: jest.fn(),
      createDraft: jest.fn(),
      reviewLiquidation: jest.fn(),
      publishLiquidation: jest.fn(),
      cancelLiquidation: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [LiquidationsController],
      providers: [
        {
          provide: LiquidationsService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .overrideGuard(TenantAccessGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .compile();

    controller = module.get(LiquidationsController);
  });

  it('uses the effective membership for liquidation reads', async () => {
    const expected: LiquidationResponseDto = {
      id: 'liq-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-05',
      chargePeriod: null,
      status: 'REVIEWED',
      totalAmountMinor: 100,
      totalsByCurrency: { ARS: 100 },
      baseCurrency: 'ARS',
      unitCount: 2,
      generatedAt: new Date(),
      reviewedAt: null,
      publishedAt: null,
      canceledAt: null,
      createdAt: new Date(),
    };
    const readDetail: LiquidationDetailDto = {
      ...expected,
      publicationSnapshotStatus: 'LEGACY',
      expenses: [],
      chargesPreview: [],
    };
    service.listLiquidations.mockResolvedValue([expected]);
    service.getLiquidation.mockResolvedValue(readDetail);
    const query: ListLiquidationsQueryDto = {
      buildingId: 'building-1',
      period: '2026-05',
    };
    const params: LiquidationParamDto = {
      liquidationId: 'c123456789012345678901234',
    };

    await controller.listLiquidations(query, stubReq());
    await controller.getLiquidation(params, stubReq());

    expect(service.listLiquidations).toHaveBeenCalledWith(
      'tenant-1',
      'member-effective',
      { buildingId: 'building-1', period: '2026-05' },
    );
    expect(service.getLiquidation).toHaveBeenCalledWith(
      'tenant-1',
      'c123456789012345678901234',
      'member-effective',
    );
  });

  it('uses the effective membership for liquidation writes', async () => {
    const detail: LiquidationDetailDto = {
      id: 'liq-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-05',
      chargePeriod: null,
      status: 'DRAFT',
      baseCurrency: 'ARS',
      totalAmountMinor: 100,
      unitCount: 2,
      totalsByCurrency: { ARS: 100 },
      generatedAt: new Date(),
      reviewedAt: null,
      publishedAt: null,
      canceledAt: null,
      createdAt: new Date(),
      publicationSnapshotStatus: 'LEGACY',
      expenses: [],
      chargesPreview: [],
    };
    const draftDto: CreateLiquidationDraftDto = {
      buildingId: 'building-1',
      baseCurrency: 'ARS',
      period: '2026-05',
    };
    const publishDto: PublishLiquidationDto = { dueDate: '2026-06-10' };
    const cancelDto: CancelLiquidationDto = { reason: 'Board decision' };
    const params: LiquidationParamDto = {
      liquidationId: 'c123456789012345678901234',
    };
    const published: LiquidationResponseDto = {
      id: 'liq-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-05',
      chargePeriod: null,
      status: 'PUBLISHED',
      totalAmountMinor: 100,
      totalsByCurrency: { ARS: 100 },
      baseCurrency: 'ARS',
      unitCount: 2,
      generatedAt: new Date(),
      reviewedAt: null,
      publishedAt: null,
      canceledAt: null,
      createdAt: new Date(),
    };
    service.createDraft.mockResolvedValue(detail);
    service.reviewLiquidation.mockResolvedValue(published);
    service.publishLiquidation.mockResolvedValue(published);
    service.cancelLiquidation.mockResolvedValue(published);

    await controller.createDraft(draftDto, stubReq());
    await controller.reviewLiquidation(params, stubReq());
    await controller.publishLiquidation(params, publishDto, stubReq());
    await controller.cancelLiquidation(params, cancelDto, stubReq());

    expect(service.createDraft).toHaveBeenCalledWith(
      'tenant-1',
      'member-effective',
      draftDto,
    );
    expect(service.reviewLiquidation).toHaveBeenCalledWith(
      'tenant-1',
      'c123456789012345678901234',
      'member-effective',
    );
    expect(service.publishLiquidation).toHaveBeenCalledWith(
      'tenant-1',
      'c123456789012345678901234',
      'member-effective',
      publishDto,
    );
    expect(service.cancelLiquidation).toHaveBeenCalledWith(
      'tenant-1',
      'c123456789012345678901234',
      'member-effective',
      { reason: 'Board decision' },
    );
  });
});
