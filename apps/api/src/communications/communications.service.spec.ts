import { Logger } from '@nestjs/common';
import { CommunicationPriority } from '@prisma/client';
import { ConfigService } from '../config/config.service';
import type { AppConfig } from '../config/config.types';
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
  readonly create?: jest.Mock;
  readonly findFirst?: jest.Mock;
  readonly findUnique: jest.Mock;
  readonly update: jest.Mock;
  readonly updateMany?: jest.Mock;
}

interface CommunicationReceiptDelegateMock {
  readonly createMany: jest.Mock;
  readonly deleteMany: jest.Mock;
}

interface CommunicationTargetDelegateMock {
  readonly findMany: jest.Mock;
}

interface MembershipDelegateMock {
  readonly findFirst: jest.Mock;
}

interface UserDelegateMock {
  readonly findMany: jest.Mock;
}

interface UnitOccupantDelegateMock {
  readonly findMany: jest.Mock;
}

interface PushSubscriptionDelegateMock {
  readonly findMany: jest.Mock;
  readonly updateMany: jest.Mock;
}

interface PrismaMock {
  readonly $transaction?: jest.Mock;
  readonly communication: CommunicationDelegateMock;
  readonly communicationReceipt?: CommunicationReceiptDelegateMock;
  readonly communicationTarget?: CommunicationTargetDelegateMock;
  readonly building?: {
    readonly findFirst: jest.Mock;
  };
  readonly membership?: MembershipDelegateMock;
  readonly user?: UserDelegateMock;
  readonly unitOccupant?: UnitOccupantDelegateMock;
  readonly pushSubscription: PushSubscriptionDelegateMock;
}

interface ValidatorsMock {
  readonly validateCommunicationBelongsToTenant: jest.Mock;
  readonly resolveRecipients: jest.Mock;
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

function buildTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 4000,
    logLevel: 'debug',
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    jwtSecret: 'a'.repeat(64),
    jwtExpiresIn: '7d',
    webOrigin: 'http://localhost:3000',
    tenantResolutionMode: 'path',
    tenantHeaderName: 'x-tenant-id',
    s3Endpoint: 'http://localhost:9000',
    s3Region: 'us-east-1',
    s3AccessKey: 'test-access-key',
    s3SecretKey: 'test-secret-key',
    s3Bucket: 'test-bucket',
    s3ForcePathStyle: true,
    s3PublicBaseUrl: 'http://localhost:9000/test-bucket',
    appBaseUrl: 'http://localhost:3000',
    uploadMaxBytes: 10485760,
    uploadAllowedMime: ['image/jpeg', 'image/png', 'application/pdf'],
    mailProvider: 'none',
    mailFrom: 'BuildingOS <no-reply@buildingos.local>',
    featurePortalResident: true,
    featurePaymentsMvp: true,
    featureEnforceUrgentForWebPush: true,
    enableWebPush: true,
    vapidPublicKey: 'public-vapid-key',
    vapidPrivateKey: 'private-vapid-key',
    vapidSubject: 'mailto:admin@example.com',
    paymentProvider: 'none',
    enablePaymentWebhooks: false,
    aiProvider: 'none',
    aiOllamaUrl: null,
    ...overrides,
  };
}

describe('CommunicationsService web push fanout', () => {
  let prisma: PrismaService & PrismaMock;
  let validators: CommunicationsValidators;
  let configService: ConfigService;
  let pushDeliveryService: PushDeliveryService;
  let service: CommunicationsService;

  beforeEach(() => {
    const communication = {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce({
          priority: 'URGENT' satisfies CommunicationPriority,
          status: 'DRAFT',
        })
        .mockResolvedValue(buildPublishedCommunication()),
      update: jest.fn().mockResolvedValue(buildPublishedCommunication()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const communicationReceipt = {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    };
    const communicationTarget = {
      findMany: jest.fn().mockResolvedValue([
        { targetType: 'ALL_TENANT', targetId: null },
      ]),
    };
    const user = {
      findMany: jest.fn().mockResolvedValue([
        { id: userOneId },
        { id: userTwoId },
      ]),
    };
    const unitOccupant = {
      findMany: jest.fn().mockResolvedValue([]),
    };
    const transactionClient = {
      communication,
      communicationReceipt,
      communicationTarget,
      user,
      unitOccupant,
    };

    prisma = Object.assign(new PrismaService(), {
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transactionClient),
      ),
      communication,
      communicationReceipt,
      communicationTarget,
      user,
      unitOccupant,
      pushSubscription: {
        findMany: jest.fn().mockResolvedValue([buildSubscription(userOneId), buildSubscription(userTwoId)]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });

    validators = new CommunicationsValidators(prisma);
    jest.spyOn(validators, 'validateCommunicationBelongsToTenant').mockResolvedValue(undefined);
    jest.spyOn(validators, 'resolveRecipients').mockResolvedValue([userOneId, userTwoId]);

    configService = new ConfigService(buildTestConfig());
    jest.spyOn(configService, 'isFeatureEnabled').mockReturnValue(true);

    pushDeliveryService = new PushDeliveryService(configService);
    jest.spyOn(pushDeliveryService, 'sendToSubscription').mockResolvedValue(buildDeliveryResult('sent'));

    service = new CommunicationsService(
      prisma,
      validators,
      configService,
      pushDeliveryService,
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
      }),
      expect.objectContaining({ urgency: 'high' }),
    );
    const payload = pushDeliveryService.sendToSubscription.mock.calls[0]?.[1];
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
        data: { revokedAt: expect.any(Date) },
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
        expect.any(Object),
        expect.objectContaining({ urgency: 'high' }),
      );
      expect(pushDeliveryService.sendToSubscription).toHaveBeenNthCalledWith(
        2,
        buildSubscription(userTwoId),
        expect.any(Object),
        expect.objectContaining({ urgency: 'high' }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CommunicationsService] Failed to send web push'),
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
        data: { revokedAt: expect.any(Date) },
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
  };
}

type CommunicationReceiptWithUser = NonNullable<CommunicationWithDetails['receipts']>[number];

function buildReceipt(userId: string): CommunicationReceiptWithUser {
  const receipt: CommunicationReceiptWithUser = {
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

  return receipt;
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

const buildingId = 'building-1';
const unitId = 'unit-1';

interface ReceiptDelegateMock {
  readonly findMany: jest.Mock;
}

interface PrismaResidentMock {
  readonly communicationReceipt: ReceiptDelegateMock;
}

function buildTarget(targetType: string, targetId?: string) {
  return { targetType, targetId: targetId ?? null };
}

function buildReceiptWithComm(
  commId: string,
  targets: Array<{ targetType: string; targetId?: string }>,
  readAt: Date | null = null,
) {
  return {
    id: `receipt-${commId}`,
    tenantId,
    userId: userOneId,
    communicationId: commId,
    readAt,
    deliveredAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    communication: {
      id: commId,
      tenantId,
      buildingId: null,
      title: `Communication ${commId}`,
      body: `Body ${commId}`,
      channel: 'IN_APP',
      status: 'SENT',
      priority: 'NORMAL',
      scheduledAt: null,
      sentAt: new Date('2026-07-01T00:00:00.000Z'),
      createdByMembershipId: 'membership-1',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      deletedAt: null,
      targets,
    },
  };
}

describe('CommunicationsService findForResidentV2 scope filtering', () => {
  let prisma: PrismaService & PrismaResidentMock;
  let validators: CommunicationsValidators;
  let service: CommunicationsService;

  beforeEach(() => {
    prisma = Object.assign(new PrismaService(), {
      communicationReceipt: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    validators = new CommunicationsValidators(prisma);
    jest.spyOn(validators, 'validateBuildingBelongsToTenant').mockResolvedValue(undefined);
    jest.spyOn(validators, 'validateUnitBelongsToTenant').mockResolvedValue(undefined);
    const configService = new ConfigService(buildTestConfig());
    const pushDeliveryService = new PushDeliveryService(configService);
    service = new CommunicationsService(prisma, validators, configService, pushDeliveryService);
  });

  it('allows ALL_TENANT communications regardless of buildingId/unitId', async () => {
    prisma.communicationReceipt.findMany.mockResolvedValue([
      buildReceiptWithComm('comm-1', [buildTarget('ALL_TENANT')]),
    ]);

    const result = await service.findForResidentV2(tenantId, userOneId, buildingId, unitId, 20);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe('comm-1');
    expect(prisma.communicationReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          communication: expect.objectContaining({
            targets: expect.objectContaining({
              some: expect.objectContaining({
                OR: expect.arrayContaining([
                  { targetType: 'ALL_TENANT' },
                  { targetType: 'ROLE' },
                  { targetType: 'BUILDING', targetId: buildingId },
                  { targetType: 'UNIT', targetId: unitId },
                ]),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('allows ROLE communications', async () => {
    prisma.communicationReceipt.findMany.mockResolvedValue([
      buildReceiptWithComm('comm-role', [buildTarget('ROLE', 'RESIDENT')]),
    ]);

    const result = await service.findForResidentV2(tenantId, userOneId, buildingId, unitId, 20);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe('comm-role');
  });

  it('allows BUILDING communications matching the selected buildingId', async () => {
    prisma.communicationReceipt.findMany.mockResolvedValue([
      buildReceiptWithComm('comm-bld', [buildTarget('BUILDING', buildingId)]),
    ]);

    const result = await service.findForResidentV2(tenantId, userOneId, buildingId, unitId, 20);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe('comm-bld');
  });

  it('allows UNIT communications matching the selected unitId', async () => {
    prisma.communicationReceipt.findMany.mockResolvedValue([
      buildReceiptWithComm('comm-unit', [buildTarget('UNIT', unitId)]),
    ]);

    const result = await service.findForResidentV2(tenantId, userOneId, buildingId, unitId, 20);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe('comm-unit');
  });

  it('excludes communications targeted exclusively to another building', async () => {
    prisma.communicationReceipt.findMany.mockResolvedValue([]);

    const result = await service.findForResidentV2(tenantId, userOneId, buildingId, unitId, 20);

    expect(result.items).toHaveLength(0);

    const callWhere = prisma.communicationReceipt.findMany.mock.calls[0][0].where;
    const orConditions = callWhere.communication.targets.some.OR;
    const buildingConditions = orConditions.filter(
      (c: { targetType: string }) => c.targetType === 'BUILDING',
    );
    expect(buildingConditions).toEqual([{ targetType: 'BUILDING', targetId: buildingId }]);
  });

  it('excludes communications targeted exclusively to another unit', async () => {
    prisma.communicationReceipt.findMany.mockResolvedValue([]);

    const result = await service.findForResidentV2(tenantId, userOneId, buildingId, unitId, 20);

    expect(result.items).toHaveLength(0);

    const callWhere = prisma.communicationReceipt.findMany.mock.calls[0][0].where;
    const orConditions = callWhere.communication.targets.some.OR;
    const unitConditions = orConditions.filter(
      (c: { targetType: string }) => c.targetType === 'UNIT',
    );
    expect(unitConditions).toEqual([{ targetType: 'UNIT', targetId: unitId }]);
  });

  it('does not include other buildingId or unitId in the scope filter OR', async () => {
    prisma.communicationReceipt.findMany.mockResolvedValue([]);

    await service.findForResidentV2(tenantId, userOneId, buildingId, unitId, 20);

    const callWhere = prisma.communicationReceipt.findMany.mock.calls[0][0].where;
    const orConditions = callWhere.communication.targets.some.OR;

    const buildingConditions = orConditions.filter(
      (c: { targetType: string }) => c.targetType === 'BUILDING',
    );
    expect(buildingConditions).toHaveLength(1);
    expect(buildingConditions[0]).toEqual({ targetType: 'BUILDING', targetId: buildingId });

    const unitConditions = orConditions.filter(
      (c: { targetType: string }) => c.targetType === 'UNIT',
    );
    expect(unitConditions).toHaveLength(1);
    expect(unitConditions[0]).toEqual({ targetType: 'UNIT', targetId: unitId });
  });
});

describe('CommunicationsService receipt synchronization on publication', () => {
  let prisma: PrismaService & PrismaMock;
  let validators: CommunicationsValidators;
  let configService: ConfigService;
  let pushDeliveryService: PushDeliveryService;
  let service: CommunicationsService;

  beforeEach(() => {
    const communication = {
      create: jest.fn().mockResolvedValue({ id: communicationId }),
      findFirst: jest.fn().mockResolvedValue({ id: communicationId }),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue(buildPublishedCommunication()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const communicationReceipt = {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const communicationTarget = {
      findMany: jest.fn().mockResolvedValue([
        { targetType: 'ALL_TENANT', targetId: null },
      ]),
    };
    const membership = {
      findFirst: jest.fn().mockResolvedValue({ id: 'membership-1' }),
    };
    const user = {
      findMany: jest.fn().mockResolvedValue([
        { id: userOneId },
      ]),
    };
    const unitOccupant = {
      findMany: jest.fn().mockResolvedValue([]),
    };
    const building = {
      findFirst: jest.fn().mockResolvedValue({ id: buildingId }),
    };
    const transactionClient = {
      communication,
      communicationReceipt,
      communicationTarget,
      building,
      membership,
      user,
      unitOccupant,
    };

    prisma = Object.assign(new PrismaService(), {
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transactionClient),
      ),
      communication,
      communicationReceipt,
      communicationTarget,
      building,
      membership,
      user,
      unitOccupant,
      pushSubscription: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    validators = new CommunicationsValidators(prisma);
    configService = new ConfigService(buildTestConfig());
    jest.spyOn(configService, 'isFeatureEnabled').mockReturnValue(false);

    pushDeliveryService = new PushDeliveryService(configService);
    jest.spyOn(pushDeliveryService, 'sendToSubscription').mockResolvedValue(buildDeliveryResult('sent'));

    service = new CommunicationsService(
      prisma,
      validators,
      configService,
      pushDeliveryService,
    );
  });

  it('does not create receipts when creating a draft communication', async () => {
    prisma.communication.create.mockResolvedValueOnce({ id: 'draft-communication' });
    prisma.communication.findUnique.mockResolvedValueOnce(buildCommunicationWithReceipts([]));

    await service.create(tenantId, userOneId, {
      title: 'Draft notice',
      body: 'Body',
      channel: 'IN_APP',
      targets: [{ targetType: 'ALL_TENANT' }],
    });

    expect(prisma.communicationReceipt.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('materializes only currently active recipients when creating a published communication', async () => {
    prisma.communicationTarget.findMany.mockResolvedValue([
      { targetType: 'BUILDING', targetId: buildingId },
    ]);
    prisma.unitOccupant.findMany.mockResolvedValue([
      { member: { userId: userOneId } },
    ]);
    prisma.communication.findUnique
      .mockResolvedValueOnce(buildCommunicationWithReceipts([userOneId]))
      .mockResolvedValueOnce(buildCommunicationWithReceipts([userOneId]));

    await service.createV2(
      tenantId,
      userOneId,
      {
        title: 'Published notice',
        body: 'Body',
        status: 'PUBLISHED',
        priority: 'NORMAL',
        scopeType: 'BUILDING',
        buildingId,
      },
      false,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.communicationReceipt.deleteMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        communicationId,
      },
    });
    expect(prisma.communicationReceipt.createMany).toHaveBeenCalledWith({
      data: [{ tenantId, communicationId, userId: userOneId }],
      skipDuplicates: true,
    });
    expect(prisma.unitOccupant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          endDate: null,
          member: expect.objectContaining({
            tenantId,
            disabledAt: null,
            status: 'ACTIVE',
          }),
        }),
      }),
    );
  });

  it('replaces stale draft receipts and sends web push only to the final recipients', async () => {
    prisma.communication.findUnique
      .mockResolvedValueOnce({
        priority: 'URGENT',
        status: 'DRAFT',
      })
      .mockResolvedValueOnce(buildCommunicationWithReceipts([userOneId]));
    prisma.communicationTarget.findMany.mockResolvedValue([
      { targetType: 'ALL_TENANT', targetId: null },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: userOneId },
    ]);
    prisma.pushSubscription.findMany.mockResolvedValue([
      buildSubscription(userOneId),
    ]);

    await service.publishV2(tenantId, communicationId, true);

    expect(prisma.communicationReceipt.deleteMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        communicationId,
      },
    });
    expect(prisma.communicationReceipt.createMany).toHaveBeenCalledWith({
      data: [{ tenantId, communicationId, userId: userOneId }],
      skipDuplicates: true,
    });
    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        userId: { in: [userOneId] },
        revokedAt: null,
      },
      select: {
        userId: true,
        endpoint: true,
        p256dh: true,
        auth: true,
      },
    });
    expect(pushDeliveryService.sendToSubscription).toHaveBeenCalledTimes(1);
  });

  it('transitions to SENT once, keeps sentAt stable, and becomes idempotent on repeated send()', async () => {
    const sentAt = new Date('2026-07-05T00:00:00.000Z');
    const publishedCommunication = buildCommunicationWithReceipts([userOneId]);
    const existingSentCommunication = buildCommunicationWithReceipts([userOneId]);
    Object.assign(existingSentCommunication, { sentAt });

    prisma.communication.findUnique
      .mockResolvedValueOnce({ status: 'DRAFT' })
      .mockResolvedValueOnce(publishedCommunication)
      .mockResolvedValueOnce({ status: 'SENT' })
      .mockResolvedValueOnce(existingSentCommunication);
    prisma.communication.updateMany.mockResolvedValueOnce({ count: 1 });

    const firstResult = await service.send(tenantId, communicationId);
    const secondResult = await service.send(tenantId, communicationId);

    expect(prisma.communication.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.communication.updateMany).toHaveBeenCalledWith({
      where: {
        id: communicationId,
        tenantId,
        status: { not: 'SENT' },
      },
      data: {
        status: 'SENT',
        sentAt: expect.any(Date) as Date,
        updatedAt: expect.any(Date) as Date,
      },
    });
    expect(prisma.communicationReceipt.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.communicationReceipt.createMany).toHaveBeenCalledTimes(1);
    expect(firstResult.receipts).toEqual(publishedCommunication.receipts);
    expect(secondResult.receipts).toEqual(existingSentCommunication.receipts);
    expect(secondResult.sentAt).toBe(sentAt);
  });

  it('does not resend web push when publishV2() receives an already SENT communication', async () => {
    const sentAt = new Date('2026-07-05T00:00:00.000Z');
    const currentCommunication = buildCommunicationWithReceipts([userOneId]);
    Object.assign(currentCommunication, { sentAt });

    prisma.communication.findUnique
      .mockResolvedValueOnce({
        priority: 'URGENT',
        status: 'SENT',
      })
      .mockResolvedValueOnce(currentCommunication);

    await service.publishV2(tenantId, communicationId, true);

    expect(prisma.communication.updateMany).not.toHaveBeenCalled();
    expect(prisma.communicationReceipt.deleteMany).not.toHaveBeenCalled();
    expect(prisma.communicationReceipt.createMany).not.toHaveBeenCalled();
    expect(pushDeliveryService.sendToSubscription).not.toHaveBeenCalled();
  });

  it('does not resend web push when publish() receives an already SENT communication', async () => {
    const sentAt = new Date('2026-07-05T00:00:00.000Z');
    const currentCommunication = buildCommunicationWithReceipts([userOneId]);
    Object.assign(currentCommunication, { sentAt });

    prisma.communication.findUnique
      .mockResolvedValueOnce({
        priority: 'URGENT',
        status: 'SENT',
      })
      .mockResolvedValueOnce(currentCommunication);

    await service.publish(tenantId, communicationId, true);

    expect(prisma.communication.updateMany).not.toHaveBeenCalled();
    expect(prisma.communicationReceipt.deleteMany).not.toHaveBeenCalled();
    expect(prisma.communicationReceipt.createMany).not.toHaveBeenCalled();
    expect(pushDeliveryService.sendToSubscription).not.toHaveBeenCalled();
  });

  it('publishes only once when updateMany wins the race and returns the refreshed recipients', async () => {
    prisma.communication.findUnique
      .mockResolvedValueOnce({
        priority: 'URGENT',
        status: 'DRAFT',
      })
      .mockResolvedValueOnce(buildCommunicationWithReceipts([userOneId]));
    prisma.communication.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.communicationTarget.findMany.mockResolvedValue([
      { targetType: 'ALL_TENANT', targetId: null },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: userOneId },
    ]);
    prisma.pushSubscription.findMany.mockResolvedValue([
      buildSubscription(userOneId),
    ]);

    const published = await service.publishV2(tenantId, communicationId, true);

    expect(prisma.communication.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.communicationReceipt.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.communicationReceipt.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.pushSubscription.findMany).toHaveBeenCalledTimes(1);
    expect(pushDeliveryService.sendToSubscription).toHaveBeenCalledTimes(1);
    expect(published.receipts).toEqual([buildReceipt(userOneId)]);
  });

  it('does not resync or push when updateMany loses the race and returns the already published communication', async () => {
    const publishedAt = new Date('2026-07-06T00:00:00.000Z');
    const alreadyPublished = buildCommunicationWithReceipts([userOneId]);
    Object.assign(alreadyPublished, { sentAt: publishedAt });

    prisma.communication.findUnique
      .mockResolvedValueOnce({
        priority: 'URGENT',
        status: 'DRAFT',
      })
      .mockResolvedValueOnce(alreadyPublished);
    prisma.communication.updateMany.mockResolvedValueOnce({ count: 0 });

    const published = await service.publishV2(tenantId, communicationId, true);

    expect(prisma.communication.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.communicationReceipt.deleteMany).not.toHaveBeenCalled();
    expect(prisma.communicationReceipt.createMany).not.toHaveBeenCalled();
    expect(pushDeliveryService.sendToSubscription).not.toHaveBeenCalled();
    expect(published.sentAt).toBe(publishedAt);
    expect(published.receipts).toEqual(alreadyPublished.receipts);
  });
});

function buildCommunicationWithReceipts(receiptUserIds: string[]): CommunicationWithDetails {
  return {
    ...buildPublishedCommunication(),
    receipts: receiptUserIds.map((userId) => buildReceipt(userId)),
  };
}

describe('CommunicationsService markAsReadForResident tenant scoping', () => {
  it('uses tenantId when reading and updating a resident receipt', async () => {
    const prisma = Object.assign(new PrismaService(), {
      communicationReceipt: {
        findFirst: jest.fn().mockResolvedValue({ readAt: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const validators = new CommunicationsValidators(prisma);
    const configService = new ConfigService(buildTestConfig());
    const pushDeliveryService = new PushDeliveryService(configService);

    const service = new CommunicationsService(
      prisma,
      validators,
      configService,
      pushDeliveryService,
    );

    await expect(
      service.markAsReadForResident(tenantId, userOneId, communicationId),
    ).resolves.toEqual({ readAt: expect.any(Date) as Date });

    expect(prisma.communicationReceipt.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId,
        communicationId,
        userId: userOneId,
      },
      select: { readAt: true },
    });
    expect(prisma.communicationReceipt.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        communicationId,
        userId: userOneId,
      },
      data: {
        readAt: expect.any(Date) as Date,
      },
    });
  });
});
