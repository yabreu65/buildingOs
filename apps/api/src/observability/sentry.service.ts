/**
 * Sentry Error Tracking Service
 * Captures and reports exceptions to Sentry
 * Includes context and tags for debugging
 */

import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { ConfigService } from '../config/config.service';

export interface SentryContext {
  requestId?: string;
  tenantId?: string;
  userId?: string;
  route?: string;
  statusCode?: number;
  [key: string]: any;
}

@Injectable()
export class SentryService {
  private isEnabled = false;

  constructor(private configService: ConfigService) {
    this.initialize();
  }

  /**
   * Initialize Sentry if DSN is configured
   */
  private initialize(): void {
    const config = this.configService.get();

    if (!config.sentryDsn) {
      console.log('[Sentry] DSN not configured, error tracking disabled');
      return;
    }

    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.nodeEnv,
      tracesSampleRate: config.nodeEnv === 'production' ? 0.1 : 1.0,

      // Redact sensitive data before sending
      beforeSend(event, hint) {
        // Remove sensitive headers
        if (event.request) {
          delete event.request.headers?.['authorization'];
          delete event.request.headers?.['cookie'];
          delete event.request.headers?.['x-api-key'];
        }

        // Redact sensitive fields from body
        if (event.request?.data) {
          const data = event.request.data;
          if (typeof data === 'object' && data !== null) {
            if ('password' in data) (data as any).password = '[REDACTED]';
            if ('token' in data) (data as any).token = '[REDACTED]';
            if ('secret' in data) (data as any).secret = '[REDACTED]';
          }
        }

        return event;
      },

      // Ignore non-error exceptions
      integrations: [
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.Modules(),
      ],
    });

    this.isEnabled = true;
    console.log('[Sentry] Initialized with DSN:', config.sentryDsn);
  }

  /**
   * Capture exception and send to Sentry
   */
  captureException(error: Error, context?: SentryContext): void {
    if (!this.isEnabled) return;

    // Set context for this error
    if (context) {
      Sentry.setContext('request', {
        requestId: context.requestId,
        tenantId: context.tenantId,
        userId: context.userId,
        route: context.route,
        statusCode: context.statusCode,
      });
    }

    // Set tags for filtering
    const tags: Record<string, string> = {};
    if (context?.tenantId) tags.tenantId = context.tenantId;
    if (context?.userId) tags.userId = context.userId;
    if (context?.route) tags.route = context.route;
    if (context?.statusCode) tags.statusCode = String(context.statusCode);

    Sentry.withScope((scope) => {
      Object.entries(tags).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
      Sentry.captureException(error);
    });
  }

  /**
   * Capture message event
   */
  captureMessage(message: string, level: 'fatal' | 'error' | 'warning' | 'info' = 'info', context?: SentryContext): void {
    if (!this.isEnabled) return;

    Sentry.withScope((scope) => {
      if (context?.tenantId) scope.setTag('tenantId', context.tenantId);
      if (context?.userId) scope.setTag('userId', context.userId);
      if (context?.route) scope.setTag('route', context.route);
      if (context?.requestId) scope.setContext('request', { requestId: context.requestId });

      Sentry.captureMessage(message, level);
    });
  }

  /**
   * Set user context for error tracking
   */
  setUser(userId: string, email?: string, username?: string): void {
    if (!this.isEnabled) return;

    Sentry.setUser({
      id: userId,
      ...(email && { email }),
      ...(username && { username }),
    });
  }

  /**
   * Clear user context
   */
  clearUser(): void {
    if (!this.isEnabled) return;
    Sentry.setUser(null);
  }

  /**
   * Check if Sentry is enabled
   */
  isConfigured(): boolean {
    return this.isEnabled;
  }

  /**
   * Flush pending events before shutdown
   */
  async flush(timeout: number = 2000): Promise<boolean> {
    if (!this.isEnabled) return true;
    return Sentry.close(timeout);
  }
}
