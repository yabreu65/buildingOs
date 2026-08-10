import { Test, TestingModule } from '@nestjs/testing';
import { LiquidationEngineService } from './liquidation-engine.service';
import { LiquidationsService } from './liquidations.service';

describe('LiquidationEngineService (wrapper over LiquidationsService)', () => {
  let service: LiquidationEngineService;
  let m1: {
    createDraft: jest.Mock;
    getLiquidation: jest.Mock;
    reviewLiquidation: jest.Mock;
    publishLiquidation: jest.Mock;
    cancelLiquidation: jest.Mock;
  };

  beforeEach(async () => {
    m1 = {
      createDraft: jest.fn(),
      getLiquidation: jest.fn(),
      reviewLiquidation: jest.fn(),
      publishLiquidation: jest.fn(),
      cancelLiquidation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidationEngineService,
        { provide: LiquidationsService, useValue: m1 },
      ],
    }).compile();

    service = module.get<LiquidationEngineService>(LiquidationEngineService);
  });

  it('createLiquidationDraft delegates to M1 with a plain DTO', async () => {
    m1.createDraft.mockResolvedValue({ id: 'liq-1' });

    const result = await service.createLiquidationDraft(
      'tenant-1',
      'building-1',
      '2026-08',
      'VES',
      'member-1',
    );

    expect(m1.createDraft).toHaveBeenCalledTimes(1);
    expect(m1.createDraft).toHaveBeenCalledWith('tenant-1', 'member-1', {
      buildingId: 'building-1',
      period: '2026-08',
      baseCurrency: 'VES',
    });
    expect(result).toEqual({ id: 'liq-1' });
  });

  it('getLiquidationDetail delegates tenant scoping to M1', async () => {
    m1.getLiquidation.mockResolvedValue({ id: 'liq-1' });

    const result = await service.getLiquidationDetail('tenant-1', 'liq-1', 'member-1');

    expect(m1.getLiquidation).toHaveBeenCalledWith('tenant-1', 'liq-1', 'member-1');
    expect(result).toEqual({ id: 'liq-1' });
  });

  it('reviewLiquidation delegates to M1', async () => {
    m1.reviewLiquidation.mockResolvedValue({ id: 'liq-1', status: 'REVIEWED' });

    const result = await service.reviewLiquidation('tenant-1', 'liq-1', 'member-1');

    expect(m1.reviewLiquidation).toHaveBeenCalledWith('tenant-1', 'liq-1', 'member-1');
    expect(result.status).toBe('REVIEWED');
  });

  it('publishLiquidation delegates with an ISO due date', async () => {
    m1.publishLiquidation.mockResolvedValue({ id: 'liq-1', status: 'PUBLISHED' });
    const dueDate = new Date('2026-09-15T00:00:00.000Z');

    const result = await service.publishLiquidation(
      'tenant-1',
      'liq-1',
      dueDate,
      'member-1',
    );

    expect(m1.publishLiquidation).toHaveBeenCalledWith('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-09-15T00:00:00.000Z',
    });
    expect(result.status).toBe('PUBLISHED');
  });

  it('cancelLiquidation delegates to M1', async () => {
    m1.cancelLiquidation.mockResolvedValue({ id: 'liq-1', status: 'CANCELED' });

    const result = await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1');

    expect(m1.cancelLiquidation).toHaveBeenCalledWith('tenant-1', 'liq-1', 'member-1');
    expect(result.status).toBe('CANCELED');
  });

  it('cannot bypass M1 rules: baseCurrency is always forwarded to M1', async () => {
    m1.createDraft.mockRejectedValue(
      new Error('LIQUIDATION_BASE_CURRENCY_MISMATCH'),
    );

    await expect(
      service.createLiquidationDraft('tenant-1', 'building-1', '2026-08', 'ARS', 'member-1'),
    ).rejects.toThrow('LIQUIDATION_BASE_CURRENCY_MISMATCH');

    expect(m1.createDraft).toHaveBeenCalledWith(
      'tenant-1',
      'member-1',
      expect.objectContaining({ baseCurrency: 'ARS' }),
    );
  });
});
