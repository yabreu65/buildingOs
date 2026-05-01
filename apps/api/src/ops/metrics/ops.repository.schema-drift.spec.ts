import { OpsRepository } from './ops.repository';

describe('OpsRepository schema drift handling', () => {
  it('returns controlled null for missing AssistantHandoff assignedAt column', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('column "assignedAt" does not exist')),
    };
    const repository = new OpsRepository(prisma as any);

    await expect(repository.getAssignP95Minutes('tenant-a')).resolves.toBeNull();
  });

  it('returns safe zero SLA counts when raw metrics table is not ready', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue({ code: 'P2022', message: 'column not found' }),
    };
    const repository = new OpsRepository(prisma as any);

    await expect(
      repository.getBreachedSlaCount({
        tenantId: 'tenant-a',
        assignMaxMinutes: 60,
        resolveMaxHours: 24,
      }),
    ).resolves.toEqual({ assign: 0, resolve: 0, total: 0 });
  });
});
