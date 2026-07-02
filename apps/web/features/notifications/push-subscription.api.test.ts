import { apiClient } from '@/shared/lib/http/client';
import {
  getExistingPushSubscription,
  isWebPushSupported,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from './push-subscription.api';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
}));

const pushEndpoint = 'https://fcm.googleapis.com/fcm/send/subscription-1';
const mockedApiClient = jest.mocked(apiClient);

describe('push subscription API', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'AQIDBA',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    Reflect.deleteProperty(window, 'PushManager');
    Reflect.deleteProperty(window, 'Notification');
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('reports unsupported when the browser lacks web push primitives', () => {
    expect(isWebPushSupported()).toBe(false);
  });

  it('returns no existing subscription when unsupported', async () => {
    await expect(getExistingPushSubscription()).resolves.toBeNull();
  });

  it('does not ask permission when the browser is unsupported', async () => {
    await expect(subscribeToWebPush('tenant-1')).rejects.toMatchObject({
      code: 'unsupported',
    });

    expect(mockedApiClient).not.toHaveBeenCalled();
  });

  it('does not ask permission when the VAPID public key is missing', async () => {
    const requestPermission = jest.fn<Promise<NotificationPermission>, []>();
    installSupportedPushEnvironment({ requestPermission });
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = '   ';

    await expect(subscribeToWebPush('tenant-1')).rejects.toMatchObject({
      code: 'missing-public-key',
    });

    expect(requestPermission).not.toHaveBeenCalled();
    expect(mockedApiClient).not.toHaveBeenCalled();
  });

  it.each(['denied', 'default'] as const)(
    'rejects %s permission without registering a service worker',
    async (permission) => {
      const requestPermission = jest.fn<Promise<NotificationPermission>, []>().mockResolvedValue(permission);
      const serviceWorker = installSupportedPushEnvironment({ requestPermission });

      await expect(subscribeToWebPush('tenant-1')).rejects.toMatchObject({
        code: 'permission-denied',
      });

      expect(serviceWorker.register).not.toHaveBeenCalled();
      expect(mockedApiClient).not.toHaveBeenCalled();
    },
  );

  it('rejects missing tenant context before asking browser permission', async () => {
    const requestPermission = jest.fn<Promise<NotificationPermission>, []>();
    installSupportedPushEnvironment({ requestPermission });

    await expect(subscribeToWebPush('   ')).rejects.toMatchObject({
      code: 'missing-tenant',
    });

    expect(requestPermission).not.toHaveBeenCalled();
    expect(mockedApiClient).not.toHaveBeenCalled();
  });

  it('sends the active tenant header when subscribing an existing browser subscription', async () => {
    const existingSubscription = createPushSubscription({
      endpoint: pushEndpoint,
      p256dh: 'client-public-key',
      auth: 'client-auth-secret',
    });
    const pushManager = createPushManager(existingSubscription);
    installSupportedPushEnvironment({ pushManager });
    mockedApiClient.mockResolvedValue({ success: true });

    await expect(subscribeToWebPush('tenant-active')).resolves.toMatchObject({
      endpoint: pushEndpoint,
      subscription: existingSubscription,
    });

    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/push/subscribe',
      method: 'POST',
      body: {
        endpoint: pushEndpoint,
        p256dh: 'client-public-key',
        auth: 'client-auth-secret',
      },
      headers: { 'X-Tenant-Id': 'tenant-active' },
    });
  });

  it('rolls back a new browser subscription when backend registration fails', async () => {
    const newSubscription = createPushSubscription({
      endpoint: pushEndpoint,
      p256dh: 'client-public-key',
      auth: 'client-auth-secret',
    });
    const pushManager = createPushManager(null, newSubscription);
    installSupportedPushEnvironment({ pushManager });
    mockedApiClient.mockRejectedValue(new Error('API unavailable'));

    await expect(subscribeToWebPush('tenant-active')).rejects.toThrow('API unavailable');

    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(newSubscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('rolls back a new browser subscription when browser keys are missing before backend registration', async () => {
    const newSubscription = createPushSubscriptionWithoutKeys(pushEndpoint);
    const pushManager = createPushManager(null, newSubscription);
    installSupportedPushEnvironment({ pushManager });

    await expect(subscribeToWebPush('tenant-active')).rejects.toMatchObject({
      code: 'missing-subscription-keys',
    });

    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(mockedApiClient).not.toHaveBeenCalled();
    expect(newSubscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('returns an inert unsubscribe result when no browser subscription exists', async () => {
    const pushManager = createPushManager(null);
    installSupportedPushEnvironment({ pushManager });

    await expect(unsubscribeFromWebPush('tenant-active')).resolves.toEqual({
      endpoint: null,
      unsubscribed: false,
    });

    expect(mockedApiClient).not.toHaveBeenCalled();
  });

  it('sends the active tenant header before unsubscribing locally', async () => {
    const subscription = createPushSubscription({
      endpoint: pushEndpoint,
      p256dh: 'client-public-key',
      auth: 'client-auth-secret',
    });
    installSupportedPushEnvironment({ pushManager: createPushManager(subscription) });
    mockedApiClient.mockResolvedValue({ success: true });

    await expect(unsubscribeFromWebPush('tenant-active')).resolves.toEqual({
      endpoint: pushEndpoint,
      unsubscribed: true,
    });

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/push/unsubscribe',
      method: 'POST',
      body: { endpoint: pushEndpoint },
      headers: { 'X-Tenant-Id': 'tenant-active' },
    });
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('reports incomplete local unsubscribe when the browser returns false after backend revoke', async () => {
    const subscription = createPushSubscription({
      endpoint: pushEndpoint,
      p256dh: 'client-public-key',
      auth: 'client-auth-secret',
    });
    jest.mocked(subscription.unsubscribe).mockResolvedValue(false);
    installSupportedPushEnvironment({ pushManager: createPushManager(subscription) });
    mockedApiClient.mockResolvedValue({ success: true });

    await expect(unsubscribeFromWebPush('tenant-active')).resolves.toEqual({
      endpoint: pushEndpoint,
      unsubscribed: false,
    });

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/push/unsubscribe',
      method: 'POST',
      body: { endpoint: pushEndpoint },
      headers: { 'X-Tenant-Id': 'tenant-active' },
    });
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('reports incomplete local unsubscribe when the browser fails after backend revoke', async () => {
    const subscription = createPushSubscription({
      endpoint: pushEndpoint,
      p256dh: 'client-public-key',
      auth: 'client-auth-secret',
    });
    jest.mocked(subscription.unsubscribe).mockRejectedValue(new Error('Browser unsubscribe failed'));
    installSupportedPushEnvironment({ pushManager: createPushManager(subscription) });
    mockedApiClient.mockResolvedValue({ success: true });

    await expect(unsubscribeFromWebPush('tenant-active')).resolves.toEqual({
      endpoint: pushEndpoint,
      unsubscribed: false,
    });

    expect(mockedApiClient).toHaveBeenCalledWith({
      path: '/push/unsubscribe',
      method: 'POST',
      body: { endpoint: pushEndpoint },
      headers: { 'X-Tenant-Id': 'tenant-active' },
    });
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not unsubscribe locally when backend revoke fails', async () => {
    const subscription = createPushSubscription({
      endpoint: pushEndpoint,
      p256dh: 'client-public-key',
      auth: 'client-auth-secret',
    });
    installSupportedPushEnvironment({ pushManager: createPushManager(subscription) });
    mockedApiClient.mockRejectedValue(new Error('API unavailable'));

    await expect(unsubscribeFromWebPush('tenant-active')).rejects.toThrow('API unavailable');

    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
});

interface PushSubscriptionFixture {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

interface PushManagerMock {
  readonly getSubscription: jest.Mock<Promise<PushSubscription | null>, []>;
  readonly subscribe: jest.Mock<Promise<PushSubscription>, [PushSubscriptionOptionsInit]>;
}

interface ServiceWorkerContainerMock {
  readonly getRegistration: jest.Mock<Promise<ServiceWorkerRegistration | undefined>, [string?]>;
  readonly register: jest.Mock<Promise<ServiceWorkerRegistration>, [string]>;
}

function createPushSubscription(fixture: PushSubscriptionFixture): PushSubscription {
  const unsubscribe = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);

  return {
    endpoint: fixture.endpoint,
    expirationTime: null,
    options: { userVisibleOnly: true },
    getKey: jest.fn().mockReturnValue(null),
    toJSON: jest.fn().mockReturnValue({
      endpoint: fixture.endpoint,
      keys: {
        p256dh: fixture.p256dh,
        auth: fixture.auth,
      },
    }),
    unsubscribe,
  } as unknown as PushSubscription;
}

function createPushSubscriptionWithoutKeys(endpoint: string): PushSubscription {
  const unsubscribe = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);

  return {
    endpoint,
    expirationTime: null,
    options: { userVisibleOnly: true },
    getKey: jest.fn<ArrayBuffer | null, [PushEncryptionKeyName]>().mockReturnValue(null),
    toJSON: jest.fn<PushSubscriptionJSON, []>().mockReturnValue({
      endpoint,
      keys: {},
    }),
    unsubscribe,
  } as unknown as PushSubscription;
}

function createPushManager(
  existingSubscription: PushSubscription | null,
  newSubscription = existingSubscription,
): PushManagerMock {
  if (!newSubscription) {
    const fallbackSubscription = createPushSubscription({
      endpoint: pushEndpoint,
      p256dh: 'fallback-public-key',
      auth: 'fallback-auth-secret',
    });
    return {
      getSubscription: jest.fn<Promise<PushSubscription | null>, []>().mockResolvedValue(existingSubscription),
      subscribe: jest.fn<Promise<PushSubscription>, [PushSubscriptionOptionsInit]>().mockResolvedValue(fallbackSubscription),
    };
  }

  return {
    getSubscription: jest.fn<Promise<PushSubscription | null>, []>().mockResolvedValue(existingSubscription),
    subscribe: jest.fn<Promise<PushSubscription>, [PushSubscriptionOptionsInit]>().mockResolvedValue(newSubscription),
  };
}

function installSupportedPushEnvironment(options: {
  readonly pushManager?: PushManagerMock;
  readonly requestPermission?: jest.Mock<Promise<NotificationPermission>, []>;
} = {}): ServiceWorkerContainerMock {
  const pushManager = options.pushManager ?? createPushManager(null);
  const registration = { pushManager } as unknown as ServiceWorkerRegistration;
  const serviceWorker: ServiceWorkerContainerMock = {
    getRegistration: jest.fn<Promise<ServiceWorkerRegistration | undefined>, [string?]>().mockResolvedValue(registration),
    register: jest.fn<Promise<ServiceWorkerRegistration>, [string]>().mockResolvedValue(registration),
  };
  const requestPermission =
    options.requestPermission ?? jest.fn<Promise<NotificationPermission>, []>().mockResolvedValue('granted');

  Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true });
  Object.defineProperty(window, 'Notification', {
    value: { permission: 'default', requestPermission },
    configurable: true,
  });
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });

  return serviceWorker;
}
