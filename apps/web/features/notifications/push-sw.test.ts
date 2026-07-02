describe('push service worker', () => {
  const originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'self');

  afterEach(() => {
    jest.resetModules();

    if (originalSelfDescriptor) {
      Object.defineProperty(globalThis, 'self', originalSelfDescriptor);
    }
  });

  it('shows a notification from a structured push payload', async () => {
    const serviceWorker = installServiceWorker();
    const waitUntil = jest.fn<void, [Promise<unknown>]>();

    serviceWorker.dispatch('push', {
      data: {
        json: jest.fn<unknown, []>().mockReturnValue({
          title: 'Maintenance update',
          body: 'Elevator inspection starts at 9 AM.',
          url: '/maintenance?ticket=42',
          data: { category: 'maintenance' },
        }),
        text: jest.fn<string, []>().mockReturnValue('fallback body'),
      },
      waitUntil,
    });

    await resolveWaitUntil(waitUntil);

    expect(serviceWorker.registration.showNotification).toHaveBeenCalledWith('Maintenance update', {
      body: 'Elevator inspection starts at 9 AM.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: {
        category: 'maintenance',
        url: '/maintenance?ticket=42',
      },
    });
  });

  it('falls back to the default title and text body when push JSON parsing fails', async () => {
    const serviceWorker = installServiceWorker();
    const waitUntil = jest.fn<void, [Promise<unknown>]>();

    serviceWorker.dispatch('push', {
      data: {
        json: jest.fn<unknown, []>().mockImplementation(() => {
          throw new Error('invalid json');
        }),
        text: jest.fn<string, []>().mockReturnValue('Plain notification body'),
      },
      waitUntil,
    });

    await resolveWaitUntil(waitUntil);

    expect(serviceWorker.registration.showNotification).toHaveBeenCalledWith('BuildingOS', {
      body: 'Plain notification body',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/' },
    });
  });

  it('focuses an existing window that already matches the notification URL', async () => {
    const focusedClient = createWindowClient('https://app.buildingos.local/maintenance?ticket=42');
    const serviceWorker = installServiceWorker({ clients: [focusedClient] });
    const waitUntil = jest.fn<void, [Promise<unknown>]>();
    const close = jest.fn<void, []>();

    serviceWorker.dispatch('notificationclick', {
      notification: {
        close,
        data: { url: '/maintenance?ticket=42' },
      },
      waitUntil,
    });

    await resolveWaitUntil(waitUntil);

    expect(close).toHaveBeenCalledTimes(1);
    expect(serviceWorker.clients.matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: true,
    });
    expect(focusedClient.focus).toHaveBeenCalledTimes(1);
    expect(serviceWorker.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a safe same-origin path when no matching window exists', async () => {
    const serviceWorker = installServiceWorker();
    const waitUntil = jest.fn<void, [Promise<unknown>]>();

    serviceWorker.dispatch('notificationclick', {
      notification: {
        close: jest.fn<void, []>(),
        data: { url: 'https://malicious.example/phishing' },
      },
      waitUntil,
    });

    await resolveWaitUntil(waitUntil);

    expect(serviceWorker.clients.openWindow).toHaveBeenCalledWith('/');
  });

  it('opens a safe fallback window when focusing the matching client fails', async () => {
    const focusedClient = createWindowClient('https://app.buildingos.local/maintenance?ticket=42');
    focusedClient.focus.mockRejectedValue(new Error('focus failed'));
    const serviceWorker = installServiceWorker({ clients: [focusedClient] });
    const waitUntil = jest.fn<void, [Promise<unknown>]>();

    serviceWorker.dispatch('notificationclick', {
      notification: {
        close: jest.fn<void, []>(),
        data: { url: '/maintenance?ticket=42' },
      },
      waitUntil,
    });

    await resolveWaitUntil(waitUntil);

    expect(focusedClient.focus).toHaveBeenCalledTimes(1);
    expect(serviceWorker.clients.openWindow).toHaveBeenCalledWith('/maintenance?ticket=42');
  });
});

interface ServiceWorkerFixtureOptions {
  readonly clients?: readonly WindowClientFixture[];
}

interface ServiceWorkerFixture {
  readonly registration: {
    readonly showNotification: jest.Mock<Promise<void>, [string, NotificationFixtureOptions]>;
  };
  readonly clients: {
    readonly matchAll: jest.Mock<Promise<readonly WindowClientFixture[]>, [ClientMatchOptions]>;
    readonly openWindow: jest.Mock<Promise<WindowClientFixture | null>, [string]>;
  };
  dispatch(type: string, event: unknown): void;
}

interface NotificationFixtureOptions {
  readonly body?: string;
  readonly icon?: string;
  readonly badge?: string;
  readonly data?: Record<string, unknown>;
}

interface ClientMatchOptions {
  readonly type: 'window';
  readonly includeUncontrolled: boolean;
}

interface WindowClientFixture {
  readonly url: string;
  readonly focus: jest.Mock<Promise<WindowClientFixture>, []>;
}

function installServiceWorker(options: ServiceWorkerFixtureOptions = {}): ServiceWorkerFixture {
  const listeners = new Map<string, (event: unknown) => void>();
  const clients = options.clients ?? [];
  const openWindowClient = createWindowClient('https://app.buildingos.local/');

  const serviceWorker = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    },
    registration: {
      showNotification: jest.fn<Promise<void>, [string, NotificationFixtureOptions]>().mockResolvedValue(undefined),
    },
    clients: {
      matchAll: jest.fn<Promise<readonly WindowClientFixture[]>, [ClientMatchOptions]>().mockResolvedValue(clients),
      openWindow: jest.fn<Promise<WindowClientFixture | null>, [string]>().mockResolvedValue(openWindowClient),
    },
    location: {
      origin: 'https://app.buildingos.local',
    },
  };

  Object.defineProperty(globalThis, 'self', {
    value: serviceWorker,
    configurable: true,
  });

  jest.isolateModules(() => {
    require('../../public/push-sw.js');
  });

  return {
    registration: serviceWorker.registration,
    clients: serviceWorker.clients,
    dispatch(type: string, event: unknown) {
      const listener = listeners.get(type);

      if (!listener) {
        throw new Error(`Missing service worker listener for ${type}`);
      }

      listener(event);
    },
  };
}

function createWindowClient(url: string): WindowClientFixture {
  const client: WindowClientFixture = {
    url,
    focus: jest.fn<Promise<WindowClientFixture>, []>(),
  };

  client.focus.mockResolvedValue(client);
  return client;
}

async function resolveWaitUntil(waitUntil: jest.Mock<void, [Promise<unknown>]>): Promise<void> {
  const promise = waitUntil.mock.calls[0]?.[0];

  if (!promise) {
    throw new Error('Expected event.waitUntil to receive a promise.');
  }

  await promise;
}
