import { InvitationsService } from './invitations.service';
import { ReleaseAWriteBarrierService } from '../tenancy/release-a-write-barrier.service';

describe('InvitationsService Release A write barrier', () => {
  const prisma = {
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

  beforeEach(() => {
    jest.clearAllMocks();
    barrier.isOpen.mockReturnValue(false);
    service = new InvitationsService(
      prisma as never,
      tenancyService as never,
      auditService as never,
      planEntitlements as never,
      authService as never,
      barrier as unknown as ReleaseAWriteBarrierService,
    );
  });

  it('performs no Prisma or audit calls while expired-invitation mutation is blocked', async () => {
    await service.markExpiredInvitations();

    expect(prisma.invitation.findMany).not.toHaveBeenCalled();
    expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
    expect(auditService.createLog).not.toHaveBeenCalled();
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

  it('continues the expiry scan after the barrier opens', async () => {
    barrier.isOpen.mockReturnValue(true);
    prisma.invitation.findMany.mockResolvedValue([]);

    await expect(service.markExpiredInvitations()).resolves.toBe(0);

    expect(prisma.invitation.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
  });
});
