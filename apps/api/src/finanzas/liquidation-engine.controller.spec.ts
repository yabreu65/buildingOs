import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { LiquidationEngineController } from './liquidation-engine.controller';
import { LiquidationEngineService } from './liquidation-engine.service';
import type { AuthenticatedRequest } from '../common/types/request.types';

describe('LiquidationEngineController', () => {
  let controller: LiquidationEngineController;
  let service: {
    createLiquidationDraft: jest.Mock;
    getLiquidationDetail: jest.Mock;
    reviewLiquidation: jest.Mock;
    publishLiquidation: jest.Mock;
    cancelLiquidation: jest.Mock;
  };

  const tenantId = 'tenant-1';
  const membershipId = 'member-1';

  const stubReq = (
    overrides: Partial<AuthenticatedRequest> = {},
  ): AuthenticatedRequest =>
    ({
      tenantId,
      user: {
        id: 'user-1',
        email: 'admin@test.com',
        membershipId,
        tenantId,
        roles: ['TENANT_ADMIN'],
      },
      ...overrides,
    }) as AuthenticatedRequest;

  beforeEach(async () => {
    service = {
      createLiquidationDraft: jest.fn(),
      getLiquidationDetail: jest.fn(),
      reviewLiquidation: jest.fn(),
      publishLiquidation: jest.fn(),
      cancelLiquidation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LiquidationEngineController],
      providers: [
        {
          provide: LiquidationEngineService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get(LiquidationEngineController);
  });

  it('creates drafts without forwarding JWT roles and uses persisted membership', async () => {
    const dto = {
      buildingId: 'building-1',
      period: '2026-05',
      baseCurrency: 'ARS',
    };

    service.createLiquidationDraft.mockResolvedValue({
      liquidation: { id: 'liq-1' },
      expenses: [],
      chargesPreview: [],
    });

    await controller.createDraft(stubReq(), dto);

    expect(service.createLiquidationDraft).toHaveBeenCalledWith(
      tenantId,
      dto.buildingId,
      dto.period,
      dto.baseCurrency,
      membershipId,
    );
  });

  it('requires membershipId for detail reads', async () => {
    await expect(
      controller.getDetail(
        {
          tenantId,
          user: {
            id: 'user-1',
            email: 'admin@test.com',
            tenantId,
            roles: ['TENANT_ADMIN'],
          },
        } as AuthenticatedRequest,
        'liq-1',
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('reads details using the persisted membership only', async () => {
    const req = stubReq();

    service.getLiquidationDetail.mockResolvedValue({
      id: 'liq-1',
      status: 'DRAFT',
      expenses: [],
      chargesPreview: [],
    });

    await controller.getDetail(req, 'liq-1');

    expect(service.getLiquidationDetail).toHaveBeenCalledWith(
      tenantId,
      'liq-1',
      membershipId,
    );
  });

  it('reviews, publishes and cancels without forwarding JWT roles', async () => {
    const params = 'liq-1';
    const publishDto = { dueDate: '2026-06-10' };

    service.reviewLiquidation.mockResolvedValue({ id: params });
    service.publishLiquidation.mockResolvedValue({ id: params });
    service.cancelLiquidation.mockResolvedValue({ id: params });

    await controller.review(stubReq(), params);
    await controller.publish(stubReq(), params, publishDto);
    await controller.cancel(stubReq(), params);

    expect(service.reviewLiquidation).toHaveBeenCalledWith(
      tenantId,
      params,
      membershipId,
    );
    expect(service.publishLiquidation).toHaveBeenCalledWith(
      tenantId,
      params,
      expect.any(Date),
      membershipId,
    );
    expect(service.cancelLiquidation).toHaveBeenCalledWith(
      tenantId,
      params,
      membershipId,
    );
  });

  it('rejects invalid due dates before reaching the service', async () => {
    await expect(
      controller.publish(stubReq(), 'liq-1', { dueDate: 'not-a-date' }),
    ).rejects.toThrow(BadRequestException);
  });
});
