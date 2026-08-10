/**
 * Sentry Exception Filter
 * Captures all exceptions and sends them to Sentry with full context
 * Includes requestId, tenantId, userId for correlation
 */

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SentryService } from './sentry.service';
import { LoggerService } from './logger.service';

type ExceptionRequest = Request & {
  tenantId?: string;
  userId?: string;
};

interface HttpExceptionResponseBody {
  message?: string | string[];
}

const SAFE_BODY_KEYS = new Set([
  'statusCode',
  'message',
  'error',
  'code',
  'originalCurrency',
  'functionalCurrency',
  'conversionDate',
  'baseCurrency',
  'quoteCurrency',
  'effectiveAt',
]);

function isSafeResponseValue(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  constructor(
    private sentry: SentryService,
    private logger: LoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<ExceptionRequest>();
    const response = ctx.getResponse<Response>();

    // Extract context from request
    const context = {
      requestId: request.id,
      tenantId: request.tenantId,
      userId: request.userId,
      route: request.route?.path || request.path,
      method: request.method,
      statusCode: undefined as number | undefined,
    };

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';
    let responseMessage = 'Internal Server Error';
    let error: Error | null = null;
    const structuredFields: Record<string, string | number | boolean | null> =
      {};

    // Handle HttpException
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : this.getHttpExceptionMessage(exceptionResponse);
      responseMessage = message;
      error = exception as Error;

      // Preserve structured safe fields (business codes and authorized metadata)
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        for (const [key, value] of Object.entries(exceptionResponse)) {
          if (SAFE_BODY_KEYS.has(key) && isSafeResponseValue(value)) {
            structuredFields[key] = value;
          }
        }
      }
    }
    // Handle regular errors
    else if (exception instanceof Error) {
      error = exception;
      message = exception.message;
      // Do not echo unexpected error internals to the client
    }
    // Handle unknown exceptions
    else {
      message = String(exception);
    }

    context.statusCode = statusCode;

    const logMessage = `[${context.requestId}] ${context.method} ${context.route} - ${statusCode}`;

    // Send to Sentry only for 5xx errors
    if (statusCode >= 500) {
      if (error) {
        this.sentry.captureException(error, context);
      } else {
        this.sentry.captureMessage(message, 'error', context);
      }
    }

    if (statusCode === 401) {
      this.logger.info(logMessage, {
        ...context,
        error: message,
      });
    } else if (statusCode === 403) {
      this.logger.warn(logMessage, {
        ...context,
        error: message,
      });
    } else if (statusCode >= 500) {
      this.logger.error(logMessage, error ?? undefined, {
        ...context,
        error: message,
      });
    } else {
      this.logger.warn(logMessage, {
        ...context,
        error: message,
      });
    }

    // Send response
    response.status(statusCode).json({
      statusCode,
      message: responseMessage,
      ...structuredFields,
      requestId: context.requestId,
      timestamp: new Date().toISOString(),
    });
  }

  private getHttpExceptionMessage(response: unknown): string {
    if (
      typeof response === 'object' &&
      response !== null &&
      'message' in response
    ) {
      const { message } = response as HttpExceptionResponseBody;

      if (Array.isArray(message)) {
        return message.join(', ');
      }

      if (typeof message === 'string' && message) {
        return message;
      }
    }

    return 'HTTP Exception';
  }
}
