import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConvertLeadDto } from './leads.dto';
import { LeadsService } from './leads.service';

jest.mock('bcrypt');

interface ConversionTransaction {
  readonly tenant: { create: jest.Mock };
  readonly subscription: { findUnique: jest.Mock; create: jest.Mock };
  readonly user: { findUnique: jest.Mock; create: jest.Mock };
  readonly membership: { create: jest.Mock };
  readonly membershipRole: { createMany: jest.Mock };
  readonly invitation: { create: jest.Mock };
  readonly lead: { update: jest.Mock };
}

describe('LeadsService', () => {
  it('creates a converted lead owner without a password until invitation acceptance', async () => {
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
      $transaction: jest.fn(async (callback: (tx: ConversionTransaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const emailService = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
    } as unknown as EmailService;
    const auditService = {
      createLog: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const configService = {
      getValue: jest.fn().mockReturnValue('https://app.example.com'),
    } as unknown as ConfigService;
    const service = new LeadsService(prisma, emailService, auditService, configService);
    const dto = {
      tenantName: 'Example Building',
      tenantType: 'CONDOMINIUM',
    } as ConvertLeadDto;

    await service.convertLeadToTenant('lead-1', dto, 'super-admin-1');

    expect(transaction.user.create).toHaveBeenCalledWith({
      data: {
        email: 'owner@example.com',
        name: 'Owner Example',
        passwordHash: '',
      },
    });
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(transaction.membershipRole.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: 'tenant-1', membershipId: 'membership-1', role: Role.TENANT_OWNER },
        { tenantId: 'tenant-1', membershipId: 'membership-1', role: Role.TENANT_ADMIN },
      ],
    });
  });
});
