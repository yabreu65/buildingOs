'use client';

import { apiClient } from '@/shared/lib/http/client';
import { arrayBufferToBase64Url, urlBase64ToUint8Array } from './push-subscription.utils';

const SERVICE_WORKER_PATH = '/push-sw.js';

export type PushSubscriptionErrorCode =
  | 'unsupported'
  | 'missing-public-key'
  | 'missing-tenant'
  | 'permission-denied'
  | 'missing-subscription-keys';

export class PushSubscriptionError extends Error {
  constructor(
    public readonly code: PushSubscriptionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PushSubscriptionError';
  }
}

interface PushSubscribeRequest {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PushSubscriptionResult {
  endpoint: string;
  subscription: PushSubscription;
}

interface PushUnsubscribeResult {
  endpoint: string | null;
  unsubscribed: boolean;
}

function getTenantHeaders(tenantId: string): Record<string, string> {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    throw new PushSubscriptionError(
      'missing-tenant',
      'Tenant context is required to manage push notifications.',
    );
  }

  return { 'X-Tenant-Id': normalizedTenantId };
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function getVapidPublicKey(): string | null {
  const value = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  return value ? value : null;
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) {
    return null;
  }

  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
  return registration?.pushManager.getSubscription() ?? null;
}

export async function subscribeToWebPush(tenantId: string): Promise<PushSubscriptionResult> {
  assertWebPushSupported();
  const headers = getTenantHeaders(tenantId);

  const vapidPublicKey = getVapidPublicKey();
  if (!vapidPublicKey) {
    throw new PushSubscriptionError(
      'missing-public-key',
      'Web push is not configured for this environment.',
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new PushSubscriptionError(
      'permission-denied',
      'Notification permission was not granted.',
    );
  }

  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription =
    existingSubscription ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));

  try {
    const request = serializePushSubscription(subscription);

    await apiClient<{ success: boolean }, PushSubscribeRequest>({
      path: '/push/subscribe',
      method: 'POST',
      body: request,
      headers,
    });

    return { endpoint: request.endpoint, subscription };
  } catch (error) {
    if (!existingSubscription) {
      await subscription.unsubscribe().catch(() => undefined);
    }
    throw error;
  }
}

export async function unsubscribeFromWebPush(tenantId: string): Promise<PushUnsubscribeResult> {
  if (!isWebPushSupported()) {
    return { endpoint: null, unsubscribed: false };
  }
  const headers = getTenantHeaders(tenantId);

  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
  const subscription = await registration?.pushManager.getSubscription();

  if (!subscription) {
    return { endpoint: null, unsubscribed: false };
  }

  const endpoint = subscription.endpoint;

  await apiClient<{ success: boolean }, { endpoint: string }>({
    path: '/push/unsubscribe',
    method: 'POST',
    body: { endpoint },
    headers,
  });

  const unsubscribed = await subscription.unsubscribe().catch(() => false);
  return { endpoint, unsubscribed };
}

function assertWebPushSupported(): void {
  if (!isWebPushSupported()) {
    throw new PushSubscriptionError(
      'unsupported',
      'This browser does not support web push notifications.',
    );
  }
}

function serializePushSubscription(subscription: PushSubscription): PushSubscribeRequest {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh ?? arrayBufferToBase64Url(subscription.getKey('p256dh'));
  const auth = json.keys?.auth ?? arrayBufferToBase64Url(subscription.getKey('auth'));

  if (!p256dh || !auth) {
    throw new PushSubscriptionError(
      'missing-subscription-keys',
      'The browser did not provide push subscription keys.',
    );
  }

  return {
    endpoint: subscription.endpoint,
    p256dh,
    auth,
  };
}
