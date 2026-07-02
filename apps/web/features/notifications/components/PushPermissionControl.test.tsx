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
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: jest.fn(),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'Notification');
  });

  it('checks status on mount without triggering browser permission or subscription', async () => {
    render(<PushPermissionControl tenantId="tenant-active" />);

    await waitFor(() => {
      expect(mockedGetExistingPushSubscription).toHaveBeenCalledTimes(1);
    });

    const notification = window.Notification as unknown as {
      readonly requestPermission: jest.Mock<Promise<NotificationPermission>, []>;
    };
    expect(notification.requestPermission).not.toHaveBeenCalled();
    expect(mockedSubscribeToWebPush).not.toHaveBeenCalled();
  });

  it('passes active tenant context when enabling push notifications from the button', async () => {
    render(<PushPermissionControl tenantId="tenant-active" />);

    const button = await screen.findByRole('button', { name: 'Activar alertas' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedSubscribeToWebPush).toHaveBeenCalledWith('tenant-active');
    });
  });

  it('does not treat an existing browser subscription as active tenant registration', async () => {
    mockedGetExistingPushSubscription.mockResolvedValue({} as PushSubscription);

    render(<PushPermissionControl tenantId="tenant-active" />);

    const button = await screen.findByRole('button', { name: 'Activar alertas' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedSubscribeToWebPush).toHaveBeenCalledWith('tenant-active');
    });
    expect(mockedUnsubscribeFromWebPush).not.toHaveBeenCalled();
  });

  it('passes active tenant context when disabling after this tenant was enabled', async () => {
    mockedGetExistingPushSubscription.mockResolvedValue({} as PushSubscription);

    render(<PushPermissionControl tenantId="tenant-active" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Activar alertas' }));
    const disableButton = await screen.findByRole('button', { name: 'Desactivar alertas' });

    fireEvent.click(disableButton);

    await waitFor(() => {
      expect(mockedUnsubscribeFromWebPush).toHaveBeenCalledWith('tenant-active');
    });
  });

  it('does not show full disable success when local browser unsubscribe is incomplete', async () => {
    mockedGetExistingPushSubscription.mockResolvedValue({} as PushSubscription);
    mockedUnsubscribeFromWebPush.mockResolvedValue({
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
      unsubscribed: false,
    });

    render(<PushPermissionControl tenantId="tenant-active" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Activar alertas' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar alertas' }));

    expect(
      await screen.findByText('Desactivamos el registro, pero el navegador no confirmó la baja local.'),
    ).toBeTruthy();
    expect(screen.queryByText('Alertas push desactivadas en este dispositivo.')).toBeNull();
  });

  it('keeps the enable action available and recovers when refresh fails on mount', async () => {
    mockedGetExistingPushSubscription
      .mockRejectedValueOnce(new Error('Service worker lookup failed'))
      .mockResolvedValue(null);

    render(<PushPermissionControl tenantId="tenant-active" />);

    const button = await screen.findByRole('button', { name: 'Activar alertas' });
    await waitFor(() => {
      expect(button).toHaveProperty('disabled', false);
    });

    expect(screen.getByText('No pudimos revisar el estado de alertas push.')).toBeTruthy();

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockedSubscribeToWebPush).toHaveBeenCalledWith('tenant-active');
    });
    expect(await screen.findByText('Alertas push activadas en este dispositivo.')).toBeTruthy();
  });

  it('shows safe copy when the browser does not provide subscription keys', async () => {
    mockedSubscribeToWebPush.mockRejectedValue(
      new PushSubscriptionError('missing-subscription-keys', 'The browser did not provide push subscription keys.'),
    );

    render(<PushPermissionControl tenantId="tenant-active" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Activar alertas' }));

    expect(
      await screen.findByText('No pudimos activar alertas porque el navegador no entregó las claves necesarias.'),
    ).toBeTruthy();
  });
});
