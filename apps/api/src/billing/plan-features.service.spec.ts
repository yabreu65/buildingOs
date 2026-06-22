import { PlanFeaturesService } from './plan-features.service';

describe('PlanFeaturesService', () => {
  const prisma = {
    subscription: {
      findFirst: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn(),
    },
  } as any;

  let service: PlanFeaturesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PlanFeaturesService(prisma);
  });

  it('enables canUseAI for demo tenants without subscription', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.tenant.findUnique.mockResolvedValue({ isDemo: true });

    await expect(service.hasFeature('tenant-demo', 'canUseAI')).resolves.toBe(true);
  });

  it('does not enable unrelated features for demo tenants without subscription', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.tenant.findUnique.mockResolvedValue({ isDemo: true });

    await expect(service.hasFeature('tenant-demo', 'canExportReports')).resolves.toBe(false);
  });
});
