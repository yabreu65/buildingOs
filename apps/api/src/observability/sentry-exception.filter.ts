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
  Logger,
} from '@nestjs/common';
import { SentryService } from './sentry.service';

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private logger = new Logger('SentryExceptionFilter');

  constructor(private sentry: SentryService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

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
          : (exceptionResponse as any).message || 'HTTP Exception';
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

    // Send to Sentry only for 5xx errors
    if (statusCode >= 500) {
      if (error) {
        this.sentry.captureException(error, context);
      } else {
        this.sentry.captureMessage(message, 'error', context);
      }
    }

    // Log the error
    this.logger.error(
      `[${context.requestId}] ${context.method} ${context.route} - ${statusCode}`,
      error?.stack || message,
    );

    // Send response
    response.status(statusCode).json({
      statusCode,
      message,
      requestId: context.requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
