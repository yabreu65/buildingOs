import { InvitationsService } from './invitations.service';
import { ReleaseAWriteBarrierService } from '../tenancy/release-a-write-barrier.service';

describe('InvitationsService Release A write barrier', () => {
  const prisma = {
    $transaction: jest.fn(),
    invitation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const tenancyService = {};
  const auditService = { createLog: jest.fn() };
  const planEntitlements = {};
  const authService = {};
  const barrier = { isOpen: jest.fn() };
  let service: InvitationsService;

  const expiredInvitation = {
    id: 'invitation-a',
    tenantId: 'tenant-a',
    email: 'resident@example.test',
    expiresAt: new Date('2020-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    barrier.isOpen.mockReturnValue(false);
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback({ invitation: { updateMany: prisma.invitation.updateMany } }),
    );
    service = new InvitationsService(
      prisma as never,
      tenancyService as never,
      auditService as never,
      planEntitlements as never,
      authService as never,
      barrier as unknown as ReleaseAWriteBarrierService,
    );
  });

  it('performs no Prisma or audit calls when initially closed', async () => {
    await service.markExpiredInvitations();

    expect(prisma.invitation.findMany).not.toHaveBeenCalled();
    expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
    expect(auditService.createLog).not.toHaveBeenCalled();
  });

  it('does not mutate or audit when the barrier closes after reads', async () => {
    barrier.isOpen.mockReturnValueOnce(true).mockReturnValue(false);
    prisma.invitation.findMany.mockResolvedValue([expiredInvitation]);

    await expect(service.markExpiredInvitations()).resolves.toBe(0);

    expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
    expect(auditService.createLog).not.toHaveBeenCalled();
  });

  it('rolls back an update if the barrier closes before the transaction callback completes', async () => {
    let committed = false;
    let updateAttempted = false;
    barrier.isOpen.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true)
      .mockReturnValueOnce(true).mockReturnValue(false);
    prisma.invitation.findMany.mockResolvedValue([expiredInvitation]);
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      let staged = false;
      const tx = {
        invitation: {
          updateMany: jest.fn(async () => {
            updateAttempted = true;
            staged = true;
            return { count: 1 };
          }),
        },
      };
      const result = await callback(tx);
      committed = staged;
      return result;
    });

    await expect(service.markExpiredInvitations()).rejects.toThrow();

    expect(updateAttempted).toBe(true);
    expect(committed).toBe(false);
    expect(auditService.createLog).not.toHaveBeenCalled();
  });

  it('does not persist audit if the barrier closes after mutation completes', async () => {
    barrier.isOpen.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true)
      .mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true)
      .mockReturnValueOnce(true).mockReturnValue(false);
    prisma.invitation.findMany.mockResolvedValue([expiredInvitation]);
    prisma.invitation.updateMany.mockResolvedValue({ count: 1 });
    const persistedAudits: unknown[] = [];
    auditService.createLog.mockImplementation(async (input: unknown, writeAllowed?: () => boolean) => {
      if (writeAllowed?.()) persistedAudits.push(input);
    });

    await expect(service.markExpiredInvitations()).resolves.toBe(1);

    expect(auditService.createLog).toHaveBeenCalledTimes(1);
    expect(auditService.createLog.mock.calls[0][1]).toEqual(expect.any(Function));
    expect(persistedAudits).toHaveLength(0);
  });

  it('fails closed when checking the barrier throws', async () => {
    barrier.isOpen.mockImplementation(() => { throw new Error('barrier unavailable'); });

    await expect(service.markExpiredInvitations()).resolves.toBe(0);

    expect(prisma.invitation.findMany).not.toHaveBeenCalled();
    expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
    expect(auditService.createLog).not.toHaveBeenCalled();
  });

  it('marks and audits expired invitations while the barrier remains open', async () => {
    barrier.isOpen.mockReturnValue(true);
    prisma.invitation.findMany.mockResolvedValue([expiredInvitation]);
    prisma.invitation.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.markExpiredInvitations()).resolves.toBe(1);

    expect(prisma.invitation.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.invitation.updateMany).toHaveBeenCalledTimes(1);
    expect(auditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: expiredInvitation.tenantId,
        entityId: expiredInvitation.id,
      }),
      expect.any(Function),
    );
  });

  it('validates an expired token without updating the invitation', async () => {
    prisma.invitation.findFirst.mockResolvedValue({
      id: 'invitation-a',
      tenantId: 'tenant-a',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1_000),
    });

    await expect(service.validateToken('expired-token')).rejects.toMatchObject({
      status: 404,
      message: 'Invitación inválida o expirada',
    });

    expect(prisma.invitation.update).not.toHaveBeenCalled();
  });
});
