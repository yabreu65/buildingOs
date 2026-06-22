import { AiEntitlementsService } from './ai-entitlements.service';

describe('AiEntitlementsService', () => {
  const prisma = {
    tenant: {
      findUnique: jest.fn(),
    },
    subscription: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  } as any;

  let service: AiEntitlementsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AiEntitlementsService(prisma);
  });

  it('allows demo tenants to chat without subscription usage checks', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ isDemo: true });

    await expect(service.hasRemainingConsultations('tenant-demo')).resolves.toBe(true);
    await expect(service.trackConsumption('tenant-demo')).resolves.toBeUndefined();

    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('returns unlimited usage for demo tenants', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ isDemo: true });

    await expect(service.getUsageStatus('tenant-demo')).resolves.toEqual({
      used: 0,
      limit: Infinity,
      percentageUsed: 0,
      remaining: Infinity,
    });
  });
});
