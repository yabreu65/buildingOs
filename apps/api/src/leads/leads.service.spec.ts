import { Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConvertLeadDto } from './leads.dto';
import { LeadsService } from './leads.service';

interface ConversionTransaction {
  readonly tenant: { create: jest.Mock };
  readonly subscription: { findUnique: jest.Mock; create: jest.Mock };
  readonly user: { findUnique: jest.Mock; create: jest.Mock };
  readonly membership: { create: jest.Mock };
  readonly membershipRole: { createMany: jest.Mock };
  readonly invitation: { create: jest.Mock };
  readonly lead: { update: jest.Mock };
}

function createConversionFixture(emailResult: Promise<unknown>) {
  let transactionCompleted = false;
  const transaction: ConversionTransaction = {
    tenant: { create: jest.fn().mockResolvedValue({ id: 'tenant-1' }) },
    subscription: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'subscription-1' }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'user-1' }),
    },
    membership: { create: jest.fn().mockResolvedValue({ id: 'membership-1' }) },
    membershipRole: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    invitation: { create: jest.fn().mockResolvedValue({ id: 'invitation-1' }) },
    lead: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    lead: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'lead-1',
        status: 'NEW',
        convertedTenantId: null,
        email: 'owner@example.com',
        fullName: 'Owner Example',
        tenantType: 'CONDOMINIUM',
      }),
    },
    billingPlan: {
      findFirst: jest.fn().mockResolvedValue({ id: 'plan-1', planId: 'BASIC' }),
    },
    $transaction: jest.fn(async (callback: (tx: ConversionTransaction) => Promise<unknown>) => {
      const result = await callback(transaction);
      transactionCompleted = true;
      return result;
    }),
  } as unknown as PrismaService;
  const emailService = {
    sendEmail: jest.fn(async () => {
      expect(transactionCompleted).toBe(true);
      return emailResult;
    }),
  } as unknown as EmailService;
  const auditService = {
    createLog: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const configService = {
    getValue: jest.fn().mockReturnValue('https://app.example.com'),
  } as unknown as ConfigService;

  return {
    service: new LeadsService(prisma, emailService, auditService, configService),
    transaction,
    emailService,
  };
}

describe('LeadsService', () => {
  const dto = {
    tenantName: 'Example Building',
    tenantType: 'CONDOMINIUM',
  } as ConvertLeadDto;

  it('commits a new owner without a password before sending its invitation once', async () => {
    const { service, transaction, emailService } = createConversionFixture(
      Promise.resolve({ success: true }),
    );

    const result = await service.convertLeadToTenant('lead-1', dto, 'super-admin-1');

    expect(transaction.user.create).toHaveBeenCalledWith({
      data: { email: 'owner@example.com', name: 'Owner Example', passwordHash: '' },
    });
    expect(transaction.membershipRole.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: 'tenant-1', membershipId: 'membership-1', role: Role.TENANT_OWNER },
        { tenantId: 'tenant-1', membershipId: 'membership-1', role: Role.TENANT_ADMIN },
      ],
    });
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@example.com', tenantId: 'tenant-1' }),
      'INVITATION',
    );
    expect(result).toEqual(expect.objectContaining({ invitationEmailStatus: 'SENT', inviteSent: true }));
    expect(result).not.toHaveProperty('inviteToken');
  });

  it('keeps the conversion committed and reports a safe failure when email sending throws', async () => {
    const { service, transaction, emailService } = createConversionFixture(
      Promise.reject(new Error('provider failure')),
    );

    const result = await service.convertLeadToTenant('lead-1', dto, 'super-admin-1');

    expect(transaction.tenant.create).toHaveBeenCalledTimes(1);
    expect(transaction.user.create).toHaveBeenCalledTimes(1);
    expect(transaction.membership.create).toHaveBeenCalledTimes(1);
    expect(transaction.invitation.create).toHaveBeenCalledTimes(1);
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ invitationEmailStatus: 'FAILED', inviteSent: false }));
    expect(JSON.stringify(result)).not.toContain('provider failure');
  });

  it('reports a disabled provider without claiming the invitation was sent', async () => {
    const { service } = createConversionFixture(Promise.resolve({ success: true, skipped: true }));

    const result = await service.convertLeadToTenant('lead-1', dto, 'super-admin-1');

    expect(result).toEqual(expect.objectContaining({ invitationEmailStatus: 'DISABLED', inviteSent: false }));
  });

  it('rotates only the converted owner pending invitation before resending it', async () => {
    let transactionCompleted = false;
    const transaction = {
      invitation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'invitation-1',
          email: 'owner@example.com',
          tokenHash: 'old-token-hash',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Example Building' }) },
    };
    const prisma = {
      lead: { findUnique: jest.fn().mockResolvedValue({ convertedTenantId: 'tenant-1' }) },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => {
        const result = await callback(transaction);
        transactionCompleted = true;
        return result;
      }),
    } as unknown as PrismaService;
    const emailService = {
      sendEmail: jest.fn(async () => {
        expect(transactionCompleted).toBe(true);
        return { success: true };
      }),
    } as unknown as EmailService;
    const service = new LeadsService(
      prisma,
      emailService,
      { createLog: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      { getValue: jest.fn().mockReturnValue('https://app.example.com') } as unknown as ConfigService,
    );

    const result = await service.resendLeadInvitation('lead-1', 'super-admin-1');

    expect(transaction.invitation.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenantId: 'tenant-1', status: 'PENDING' }),
    });
    expect(transaction.invitation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'invitation-1', tokenHash: 'old-token-hash' }),
      data: expect.objectContaining({ tokenHash: expect.any(String), expiresAt: expect.any(Date) }),
    });
    expect(transaction.invitation.updateMany.mock.calls[0][0].data.tokenHash).not.toBe('old-token-hash');
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ invitationEmailStatus: 'SENT' });
  });
});
