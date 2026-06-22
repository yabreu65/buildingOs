import { ExecutionContext } from '@nestjs/common';
import { DemoTenantGuard } from './demo-tenant.guard';

describe('DemoTenantGuard', () => {
  const prisma = {
    tenant: {
      findUnique: jest.fn(),
    },
  } as any;

  let guard: DemoTenantGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new DemoTenantGuard(prisma);
  });

  function buildContext(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  it('allows assistant chat posts for demo tenants', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ isDemo: true });

    await expect(
      guard.canActivate(
        buildContext({
          method: 'POST',
          originalUrl: '/tenants/demo-1/assistant/chat/v2',
          params: { tenantId: 'demo-1' },
        }),
      ),
    ).resolves.toBe(true);

    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('blocks non-assistant mutations for demo tenants', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ isDemo: true });

    await expect(
      guard.canActivate(
        buildContext({
          method: 'POST',
          originalUrl: '/tenants/demo-1/tickets',
          params: { tenantId: 'demo-1' },
        }),
      ),
    ).rejects.toThrow('This demo environment is read-only');
  });
});
