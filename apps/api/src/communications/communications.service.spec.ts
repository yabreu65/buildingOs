import { Logger } from '@nestjs/common';
import { CommunicationPriority } from '@prisma/client';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PushDeliveryService,
  type PushDeliveryResult,
  type PushNotificationPayload,
  type StoredPushSubscription,
} from '../push/push-delivery.service';
import { CommunicationsService, type CommunicationWithDetails } from './communications.service';
import { CommunicationsValidators } from './communications.validators';

interface CommunicationDelegateMock {
  readonly findUnique: jest.Mock;
  readonly update: jest.Mock;
}

interface PushSubscriptionDelegateMock {
  readonly findMany: jest.Mock;
  readonly updateMany: jest.Mock;
}

interface PrismaMock {
  readonly communication: CommunicationDelegateMock;
  readonly pushSubscription: PushSubscriptionDelegateMock;
}

interface ValidatorsMock {
  readonly validateCommunicationBelongsToTenant: jest.Mock;
}

interface ConfigServiceMock {
  readonly isFeatureEnabled: jest.Mock;
}

interface PushDeliveryServiceMock {
  readonly sendToSubscription: jest.Mock;
}

interface CommunicationPushSubscription extends StoredPushSubscription {
  readonly userId: string;
}

const tenantId = 'tenant-1';
const otherTenantId = 'tenant-2';
const communicationId = 'communication-1';
const userOneId = 'user-1';
const userTwoId = 'user-2';

describe('CommunicationsService web push fanout', () => {
  let prisma: PrismaMock;
  let validators: ValidatorsMock;
  let configService: ConfigServiceMock;
  let pushDeliveryService: PushDeliveryServiceMock;
  let service: CommunicationsService;

  beforeEach(() => {
    prisma = {
      communication: {
        findUnique: jest.fn().mockResolvedValue({
          priority: 'URGENT' satisfies CommunicationPriority,
          status: 'DRAFT',
        }),
        update: jest.fn().mockResolvedValue(buildPublishedCommunication()),
      },
      pushSubscription: {
        findMany: jest.fn().mockResolvedValue([buildSubscription(userOneId), buildSubscription(userTwoId)]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    validators = {
      validateCommunicationBelongsToTenant: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      isFeatureEnabled: jest.fn().mockReturnValue(true),
    };
    pushDeliveryService = {
      sendToSubscription: jest.fn().mockResolvedValue(buildDeliveryResult('sent')),
    };

    service = new CommunicationsService(
      prisma as unknown as PrismaService,
      validators as unknown as CommunicationsValidators,
      configService as unknown as ConfigService,
      pushDeliveryService as unknown as PushDeliveryService,
    );
  });

  it('sends push notifications to eligible active subscriptions when publishing with web push', async () => {
    await service.publishV2(tenantId, communicationId, true);

    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        userId: { in: [userOneId, userTwoId] },
        revokedAt: null,
      },
      select: {
        userId: true,
        endpoint: true,
        p256dh: true,
        auth: true,
      },
    });
    expect(pushDeliveryService.sendToSubscription).toHaveBeenCalledTimes(2);
    expect(pushDeliveryService.sendToSubscription).toHaveBeenCalledWith(
      buildSubscription(userOneId),
      expect.objectContaining({
        title: 'New communication',
        body: 'Open BuildingOS to view the latest communication.',
        url: `/communications/${communicationId}`,
        tag: `communication:${communicationId}`,
        data: expect.objectContaining({
          communicationId,
          tenantId,
          type: 'communication',
          url: `/communications/${communicationId}`,
          tag: `communication:${communicationId}`,
        }),
      }) as PushNotificationPayload,
      expect.objectContaining({ urgency: 'high' }),
    );
    const [, payload] = pushDeliveryService.sendToSubscription.mock.calls[0] as [
      CommunicationPushSubscription,
      PushNotificationPayload,
      unknown,
    ];
    expect(JSON.stringify(payload)).not.toContain('Please review the update.');
    expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
  });

  it('sends push notifications through the legacy publish path when web push is requested', async () => {
    await service.publish(tenantId, communicationId, true);

    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          userId: { in: [userOneId, userTwoId] },
          revokedAt: null,
        }),
      }),
    );
    expect(pushDeliveryService.sendToSubscription).toHaveBeenCalledTimes(2);
    expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
  });

  it('does not query or send push subscriptions through the legacy publish path when web push is not requested', async () => {
    await service.publish(tenantId, communicationId, false);

    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(pushDeliveryService.sendToSubscription).not.toHaveBeenCalled();
    expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
  });

  it('uses tenant and recipient filters so fanout and cleanup cannot cross tenants', async () => {
    pushDeliveryService.sendToSubscription.mockResolvedValue(buildDeliveryResult('expired'));

    await service.publishV2(tenantId, communicationId, true);

    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          userId: { in: [userOneId, userTwoId] },
          revokedAt: null,
        }),
      }),
    );
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: otherTenantId }),
      }),
    );
    expect(prisma.pushSubscription.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        userId: userOneId,
        endpoint: buildSubscription(userOneId).endpoint,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });

  it('revokes only the matching subscription when one delivery expires', async () => {
    pushDeliveryService.sendToSubscription
      .mockResolvedValueOnce(buildDeliveryResult('expired'))
      .mockResolvedValueOnce(buildDeliveryResult('sent'));

    await service.publishV2(tenantId, communicationId, true);

    expect(prisma.pushSubscription.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.pushSubscription.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        userId: userOneId,
        endpoint: buildSubscription(userOneId).endpoint,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });

  it('keeps publishing best-effort when one subscription send fails and another expires', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    pushDeliveryService.sendToSubscription
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce(buildDeliveryResult('expired'));

    try {
      await expect(service.publishV2(tenantId, communicationId, true)).resolves.toEqual(
        buildPublishedCommunication(),
      );

      expect(pushDeliveryService.sendToSubscription).toHaveBeenCalledTimes(2);
      expect(pushDeliveryService.sendToSubscription).toHaveBeenNthCalledWith(
        1,
        buildSubscription(userOneId),
        expect.any(Object) as PushNotificationPayload,
        expect.objectContaining({ urgency: 'high' }),
      );
      expect(pushDeliveryService.sendToSubscription).toHaveBeenNthCalledWith(
        2,
        buildSubscription(userTwoId),
        expect.any(Object) as PushNotificationPayload,
        expect.objectContaining({ urgency: 'high' }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[CommunicationsService] Failed to send web push',
        expect.not.objectContaining({ endpoint: expect.any(String) as string }),
      );
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(buildSubscription(userOneId).endpoint);
      expect(prisma.pushSubscription.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.pushSubscription.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          userId: userTwoId,
          endpoint: buildSubscription(userTwoId).endpoint,
          revokedAt: null,
        },
        data: { revokedAt: expect.any(Date) as Date },
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('degrades safely when push delivery is disabled or unconfigured', async () => {
    pushDeliveryService.sendToSubscription.mockResolvedValue(buildDeliveryResult('skipped_disabled'));

    await expect(service.publishV2(tenantId, communicationId, true)).resolves.toEqual(
      buildPublishedCommunication(),
    );

    expect(pushDeliveryService.sendToSubscription).toHaveBeenCalledTimes(2);
    expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
  });

  it('does not query or send push subscriptions when web push is not requested', async () => {
    await service.publishV2(tenantId, communicationId, false);

    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(pushDeliveryService.sendToSubscription).not.toHaveBeenCalled();
    expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
  });
});

function buildPublishedCommunication(): CommunicationWithDetails {
  return {
    id: communicationId,
    tenantId,
    buildingId: null,
    title: 'Urgent notice',
    body: 'Please review the update.',
    channel: 'IN_APP',
    status: 'SENT',
    priority: 'URGENT',
    scheduledAt: null,
    sentAt: new Date('2026-07-02T00:00:00.000Z'),
    createdByMembershipId: 'membership-1',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    deletedAt: null,
    targets: [],
    receipts: [
      buildReceipt(userOneId),
      buildReceipt(userTwoId),
      buildReceipt(userOneId),
    ],
    createdByMembership: {
      id: 'membership-1',
      tenantId,
      userId: 'admin-user',
      buildingId: null,
      roles: [],
      inviteStatus: 'ACCEPTED',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      user: {
        id: 'admin-user',
        name: 'Admin User',
        email: 'admin@example.com',
      },
    },
  } as unknown as CommunicationWithDetails;
}

function buildReceipt(userId: string): unknown {
  return {
    id: `receipt-${userId}`,
    tenantId,
    communicationId,
    userId,
    readAt: null,
    deliveredAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    user: {
      id: userId,
      name: `User ${userId}`,
      email: `${userId}@example.com`,
    },
  };
}

function buildSubscription(userId: string): CommunicationPushSubscription {
  return {
    userId,
    endpoint: `https://fcm.googleapis.com/fcm/send/${userId}`,
    p256dh: `p256dh-${userId}`,
    auth: `auth-${userId}`,
  };
}

function buildDeliveryResult(status: PushDeliveryResult['status']): PushDeliveryResult {
  return {
    status,
    success: status === 'sent' || status === 'skipped_disabled',
    skipped: status === 'skipped_disabled' ? true : undefined,
  };
}
