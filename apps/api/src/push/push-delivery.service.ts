import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import type {
  PushSubscription,
  RequestOptions,
  SendResult,
  Urgency,
} from 'web-push';
import { ConfigService } from '../config/config.service';

export interface StoredPushSubscription {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export interface PushNotificationPayload {
  readonly title: string;
  readonly body?: string;
  readonly url?: string;
  readonly tag?: string;
  readonly data?: Record<string, unknown>;
}

export type PushDeliveryStatus =
  | 'sent'
  | 'skipped_disabled'
  | 'expired'
  | 'retryable'
  | 'failed';

export interface PushDeliveryResult {
  readonly status: PushDeliveryStatus;
  readonly success: boolean;
  readonly skipped?: boolean;
  readonly statusCode?: number;
  readonly retryable?: boolean;
  readonly reason?: string;
}

export interface PushDeliveryOptions {
  readonly ttlSeconds?: number;
  readonly urgency?: Urgency;
  readonly topic?: string;
}

@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger(PushDeliveryService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Send a JSON web-push payload to an existing browser subscription.
   */
  async sendToSubscription(
    subscription: StoredPushSubscription,
    payload: PushNotificationPayload,
    options: PushDeliveryOptions = {},
  ): Promise<PushDeliveryResult> {
    const config = this.configService.get();

    if (!config.enableWebPush) {
      return {
        status: 'skipped_disabled',
        success: true,
        skipped: true,
        reason: 'Web push delivery is disabled',
      };
    }

    if (!config.vapidSubject || !config.vapidPublicKey || !config.vapidPrivateKey) {
      this.logger.warn('[Push] Web push is enabled but VAPID config is incomplete');
      return {
        status: 'skipped_disabled',
        success: true,
        skipped: true,
        reason: 'Web push delivery is not configured',
      };
    }

    const pushSubscription = this.toWebPushSubscription(subscription);
    const requestOptions = this.toRequestOptions(options);

    try {
      webpush.setVapidDetails(
        config.vapidSubject,
        config.vapidPublicKey,
        config.vapidPrivateKey,
      );

      const result = await webpush.sendNotification(
        pushSubscription,
        JSON.stringify(payload),
        requestOptions,
      );

      return this.toSuccessResult(result);
    } catch (error) {
      return this.toFailureResult(error);
    }
  }

  private toWebPushSubscription(
    subscription: StoredPushSubscription,
  ): PushSubscription {
    return {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    };
  }

  private toRequestOptions(options: PushDeliveryOptions): RequestOptions {
    const requestOptions: RequestOptions = {
      TTL: options.ttlSeconds ?? 60,
      urgency: options.urgency ?? 'normal',
    };

    if (options.topic) {
      requestOptions.topic = options.topic;
    }

    return requestOptions;
  }

  private toSuccessResult(result: SendResult): PushDeliveryResult {
    return {
      status: 'sent',
      success: true,
      statusCode: result.statusCode,
    };
  }

  private toFailureResult(error: unknown): PushDeliveryResult {
    const statusCode = getWebPushStatusCode(error);

    if (statusCode === 404 || statusCode === 410) {
      return {
        status: 'expired',
        success: false,
        statusCode,
        reason: 'Push subscription is expired or invalid',
      };
    }

    if (statusCode === 429 || isRetryableStatus(statusCode)) {
      return {
        status: 'retryable',
        success: false,
        statusCode,
        retryable: true,
        reason: 'Push provider returned a retryable error',
      };
    }

    return {
      status: 'failed',
      success: false,
      statusCode,
      reason: error instanceof Error ? error.message : 'Push delivery failed',
    };
  }
}

function getWebPushStatusCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const candidate = error as { readonly statusCode?: unknown };
    if (typeof candidate.statusCode === 'number') {
      return candidate.statusCode;
    }
  }

  return undefined;
}

function isRetryableStatus(statusCode: number | undefined): boolean {
  return statusCode !== undefined && statusCode >= 500 && statusCode < 600;
}
