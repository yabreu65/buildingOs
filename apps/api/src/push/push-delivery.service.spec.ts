import * as webpush from 'web-push';
import type { SendResult } from 'web-push';
import { ConfigService } from '../config/config.service';
import type { AppConfig } from '../config/config.types';
import {
  PushDeliveryService,
  type PushNotificationPayload,
  type StoredPushSubscription,
} from './push-delivery.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

describe('PushDeliveryService', () => {
  const webPushMock = webpush as jest.Mocked<typeof webpush>;

  let configService: ConfigServiceMock;
  let service: PushDeliveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    configService = {
      get: jest.fn(() => buildConfig()),
    };
    webPushMock.sendNotification.mockResolvedValue(buildSendResult());
    service = new PushDeliveryService(
      configService as unknown as ConfigService,
    );
  });

  it('skips safely when web push delivery is disabled', async () => {
    configService.get.mockReturnValue(buildConfig({ enableWebPush: false }));

    await expect(
      service.sendToSubscription(buildSubscription(), buildPayload()),
    ).resolves.toEqual({
      status: 'skipped_disabled',
      success: true,
      skipped: true,
      reason: 'Web push delivery is disabled',
    });

    expect(webPushMock.setVapidDetails).not.toHaveBeenCalled();
    expect(webPushMock.sendNotification).not.toHaveBeenCalled();
  });

  it('configures VAPID details and sends the JSON payload when enabled', async () => {
    const subscription = buildSubscription();
    const payload = buildPayload();

    await expect(
      service.sendToSubscription(subscription, payload),
    ).resolves.toEqual({
      status: 'sent',
      success: true,
      statusCode: 201,
    });

    expect(webPushMock.setVapidDetails).toHaveBeenCalledWith(
      'mailto:admin@example.com',
      'public-vapid-key',
      'private-vapid-key',
    );
    expect(webPushMock.sendNotification).toHaveBeenCalledWith(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload),
      {
        TTL: 60,
        urgency: 'normal',
      },
    );
  });

  it.each([404, 410])(
    'returns expired when the push provider returns %s',
    async (statusCode) => {
      webPushMock.sendNotification.mockRejectedValue({ statusCode });

      await expect(
        service.sendToSubscription(buildSubscription(), buildPayload()),
      ).resolves.toEqual({
        status: 'expired',
        success: false,
        statusCode,
        reason: 'Push subscription is expired or invalid',
      });
    },
  );

  it('returns retryable when the push provider rate limits delivery', async () => {
    webPushMock.sendNotification.mockRejectedValue({ statusCode: 429 });

    await expect(
      service.sendToSubscription(buildSubscription(), buildPayload()),
    ).resolves.toEqual({
      status: 'retryable',
      success: false,
      statusCode: 429,
      retryable: true,
      reason: 'Push provider returned a retryable error',
    });
  });

  it('returns retryable when the push provider returns a server error', async () => {
    webPushMock.sendNotification.mockRejectedValue({ statusCode: 503 });

    await expect(
      service.sendToSubscription(buildSubscription(), buildPayload()),
    ).resolves.toEqual({
      status: 'retryable',
      success: false,
      statusCode: 503,
      retryable: true,
      reason: 'Push provider returned a retryable error',
    });
  });

  it('returns failed when the push provider returns a non-retryable delivery error', async () => {
    webPushMock.sendNotification.mockRejectedValue(
      Object.assign(new Error('Push provider rejected the payload'), {
        statusCode: 400,
      }),
    );

    await expect(
      service.sendToSubscription(buildSubscription(), buildPayload()),
    ).resolves.toEqual({
      status: 'failed',
      success: false,
      statusCode: 400,
      reason: 'Push provider rejected the payload',
    });
  });

  it('skips safely when enabled but VAPID config is incomplete', async () => {
    configService.get.mockReturnValue(buildConfig({ vapidPrivateKey: undefined }));

    await expect(
      service.sendToSubscription(buildSubscription(), buildPayload()),
    ).resolves.toEqual({
      status: 'skipped_disabled',
      success: true,
      skipped: true,
      reason: 'Web push delivery is not configured',
    });

    expect(webPushMock.setVapidDetails).not.toHaveBeenCalled();
    expect(webPushMock.sendNotification).not.toHaveBeenCalled();
  });
});

interface ConfigServiceMock {
  readonly get: jest.Mock<AppConfig, []>;
}

function buildSubscription(): StoredPushSubscription {
  return {
    endpoint: 'https://push.example/subscription-1',
    p256dh: 'client-public-key',
    auth: 'client-auth-secret',
  };
}

function buildPayload(): PushNotificationPayload {
  return {
    title: 'Building update',
    body: 'A new notification is available.',
    url: '/notifications/1',
    data: {
      notificationId: 'notification-1',
    },
  };
}

function buildSendResult(): SendResult {
  return {
    statusCode: 201,
    body: '',
    headers: {},
  };
}

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
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
