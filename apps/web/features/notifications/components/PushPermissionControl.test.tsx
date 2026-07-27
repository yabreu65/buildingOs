/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  getExistingPushSubscription,
  getVapidPublicKey,
  isWebPushSupported,
  PushSubscriptionError,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from '../push-subscription.api';
import { PushPermissionControl } from './PushPermissionControl';
import { PushPermissionProvider } from './PushPermissionProvider';

jest.mock('../push-subscription.api', () => ({
  getExistingPushSubscription: jest.fn(),
  getVapidPublicKey: jest.fn(),
  isWebPushSupported: jest.fn(),
  subscribeToWebPush: jest.fn(),
  unsubscribeFromWebPush: jest.fn(),
  PushSubscriptionError: class PushSubscriptionError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const mockedGetExistingPushSubscription = jest.mocked(getExistingPushSubscription);
const mockedGetVapidPublicKey = jest.mocked(getVapidPublicKey);
const mockedIsWebPushSupported = jest.mocked(isWebPushSupported);
const mockedSubscribeToWebPush = jest.mocked(subscribeToWebPush);
const mockedUnsubscribeFromWebPush = jest.mocked(unsubscribeFromWebPush);
let mockRequestPermission: jest.Mock;

function renderSharedControls(tenantId = 'tenant-active') {
  return render(
    <PushPermissionProvider key={tenantId} tenantId={tenantId}>
      <div>
        <PushPermissionControl />
        <PushPermissionControl />
      </div>
    </PushPermissionProvider>,
  );
}

describe('PushPermissionControl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsWebPushSupported.mockReturnValue(true);
    mockedGetVapidPublicKey.mockReturnValue('public-key');
    mockedGetExistingPushSubscription.mockResolvedValue(null);
    mockedSubscribeToWebPush.mockResolvedValue({
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
      subscription: {} as PushSubscription,
    });
    mockedUnsubscribeFromWebPush.mockResolvedValue({
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
      unsubscribed: true,
    });
    mockRequestPermission = jest.fn();
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: mockRequestPermission,
      },
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'Notification');
  });

  it('loads push status once for the shared tenant state', async () => {
    renderSharedControls();

    await waitFor(() => {
      expect(mockedGetExistingPushSubscription).toHaveBeenCalledTimes(1);
    });
    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(mockedSubscribeToWebPush).toHaveBeenCalledTimes(0);
    expect(mockedUnsubscribeFromWebPush).toHaveBeenCalledTimes(0);
    expect(screen.getAllByRole('button', { name: 'Activar alertas' })).toHaveLength(2);
  });

  it('shares activation and deactivation across both presentations without duplicating calls', async () => {
    renderSharedControls();

    await waitFor(() => {
      expect(mockedGetExistingPushSubscription).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Activar alertas' })[0]);

    await waitFor(() => {
      expect(mockedSubscribeToWebPush).toHaveBeenCalledTimes(1);
      expect(mockedSubscribeToWebPush).toHaveBeenCalledWith('tenant-active');
      expect(screen.getAllByRole('button', { name: 'Desactivar alertas' })).toHaveLength(2);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Desactivar alertas' })[1]);

    await waitFor(() => {
      expect(mockedUnsubscribeFromWebPush).toHaveBeenCalledTimes(1);
      expect(mockedUnsubscribeFromWebPush).toHaveBeenCalledWith('tenant-active');
      expect(screen.getAllByRole('button', { name: 'Activar alertas' })).toHaveLength(2);
    });
  });

  it('does not treat an existing browser subscription as active tenant registration', async () => {
    mockedGetExistingPushSubscription.mockResolvedValue({} as PushSubscription);

    renderSharedControls();

    await waitFor(() => {
      expect(mockedGetExistingPushSubscription).toHaveBeenCalledTimes(1);
    });

    expect(screen.getAllByRole('button', { name: 'Activar alertas' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Activar alertas' })[0]);

    await waitFor(() => {
      expect(mockedSubscribeToWebPush).toHaveBeenCalledTimes(1);
      expect(mockedUnsubscribeFromWebPush).toHaveBeenCalledTimes(0);
    });
  });

  it('reinitializes the controller when the tenant changes', async () => {
    const { rerender } = render(
      <PushPermissionProvider key="tenant-a" tenantId="tenant-a">
        <PushPermissionControl />
      </PushPermissionProvider>,
    );

    await waitFor(() => {
      expect(mockedGetExistingPushSubscription).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Activar alertas' }));

    await waitFor(() => {
      expect(mockedSubscribeToWebPush).toHaveBeenCalledWith('tenant-a');
      expect(screen.getByRole('button', { name: 'Desactivar alertas' })).toBeTruthy();
    });

    mockedSubscribeToWebPush.mockClear();
    mockedGetExistingPushSubscription.mockClear();

    rerender(
      <PushPermissionProvider key="tenant-b" tenantId="tenant-b">
        <PushPermissionControl />
      </PushPermissionProvider>,
    );

    await waitFor(() => {
      expect(mockedGetExistingPushSubscription).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Activar alertas' })).toBeTruthy();
    });
  });

  it('keeps the enable action available and recovers when refresh fails on mount', async () => {
    mockedGetExistingPushSubscription
      .mockRejectedValueOnce(new Error('Service worker lookup failed'))
      .mockResolvedValue(null);

    renderSharedControls();

    const button = (await screen.findAllByRole('button', { name: 'Activar alertas' }))[0];
    await waitFor(() => {
      expect(button).toHaveProperty('disabled', false);
    });

    expect(screen.getAllByText('No pudimos revisar el estado de alertas push.')[0]).toBeTruthy();

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedSubscribeToWebPush).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findAllByText('Alertas push activadas en este dispositivo.')).toHaveLength(2);
  });

  it('shows safe copy when the browser does not provide subscription keys', async () => {
    mockedSubscribeToWebPush.mockRejectedValue(
      new PushSubscriptionError('missing-subscription-keys', 'The browser did not provide push subscription keys.'),
    );

    render(
      <PushPermissionProvider tenantId="tenant-active">
        <PushPermissionControl />
      </PushPermissionProvider>,
    );

    const button = await screen.findByRole('button', { name: 'Activar alertas' });
    await waitFor(() => {
      expect(mockedGetExistingPushSubscription).toHaveBeenCalledTimes(1);
      expect(button).toHaveProperty('disabled', false);
    });

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedSubscribeToWebPush).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText('No pudimos activar alertas porque el navegador no entregó las claves necesarias.')).toBeTruthy();
    });
  });

  it('renders the action button with the mobile touch target height', async () => {
    renderSharedControls();

    await waitFor(() => {
      expect(mockedGetExistingPushSubscription).toHaveBeenCalledTimes(1);
    });

    expect(screen.getAllByRole('button', { name: 'Activar alertas' })[0]?.className).toContain('min-h-11');
  });

  it('shows the explicit local unsubscribe warning when the browser keeps the local record', async () => {
    render(
      <PushPermissionProvider tenantId="tenant-active">
        <PushPermissionControl />
      </PushPermissionProvider>,
    );

    const activateButton = await screen.findByRole('button', { name: 'Activar alertas' });
    await waitFor(() => {
      expect(mockedGetExistingPushSubscription).toHaveBeenCalledTimes(1);
      expect(activateButton).toHaveProperty('disabled', false);
    });

    fireEvent.click(activateButton);

    await waitFor(() => {
      expect(mockedSubscribeToWebPush).toHaveBeenCalledWith('tenant-active');
    });

    mockedUnsubscribeFromWebPush.mockResolvedValueOnce({
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
      unsubscribed: false,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar alertas' }));

    await waitFor(() => {
      expect(mockedUnsubscribeFromWebPush).toHaveBeenCalledWith('tenant-active');
    });

    expect(
      await screen.findByText('Desactivamos el registro, pero el navegador no confirmó la baja local.'),
    ).toBeTruthy();
    expect(screen.queryByText('Alertas push desactivadas en este dispositivo.')).toBeNull();
  });
});
