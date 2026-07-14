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
    let error: Error | null = null;

    // Handle HttpException
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : this.getHttpExceptionMessage(exceptionResponse);
      error = exception as Error;
    }
    // Handle regular errors
    else if (exception instanceof Error) {
      error = exception;
      message = exception.message;
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
      message,
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
