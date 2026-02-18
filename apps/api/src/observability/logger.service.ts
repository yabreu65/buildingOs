/**
 * Structured Logger Service
 * Uses Pino for fast, structured JSON logging
 * Automatically redacts sensitive data
 */

import { Injectable, Logger as NestLogger } from '@nestjs/common';
import pino, { Logger as PinoLogger } from 'pino';
import { ConfigService } from '../config/config.service';

export interface LogContext {
  requestId?: string;
  tenantId?: string;
  userId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  error?: Error | string;
  [key: string]: any;
}

@Injectable()
export class LoggerService {
  private pinoLogger: PinoLogger;
  private nestLogger = new NestLogger('LoggerService');

  constructor(private configService: ConfigService) {
    this.pinoLogger = this.initializePino();
  }

  /**
   * Initialize Pino logger with environment-specific configuration
   */
  private initializePino(): PinoLogger {
    const config = this.configService.get();
    const isDev = config.nodeEnv === 'development';

    return pino({
      level: isDev ? 'debug' : config.logLevel,

      // Format logs as JSON in production, pretty-print in development
      transport: isDev ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      } : undefined,

      // Redact sensitive fields
      redact: {
        paths: [
          'password',
          'passwordHash',
          'password_confirmation',
          'authorization',
          'cookie',
          'set-cookie',
          'x-api-key',
          'x-auth-token',
          'jwt',
          'token',
          'secret',
          'aws_secret_access_key',
          'sendgrid_api_key',
          'sendgrid.api_key',
          'smtp_pass',
          'smtp.pass',
          'minio_secret_key',
          'minio.secret_key',
        ],
        censor: '[REDACTED]',
      },

      // Serializers for common objects
      serializers: {
        req: (req: any) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          headers: {
            'user-agent': req.headers['user-agent'],
            'x-tenant-id': req.headers['x-tenant-id'],
            'x-forwarded-for': req.headers['x-forwarded-for'],
            // Don't include authorization header
          },
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        }),
        res: (res: any) => ({
          statusCode: res.statusCode,
          headers: {
            'content-length': res.getHeader('content-length'),
          },
        }),
        err: pino.stdSerializers.err,
      },
    });
  }

  /**
   * Log an informational message
   */
  info(message: string, context?: LogContext): void {
    this.pinoLogger.info(context || {}, message);
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: LogContext): void {
    this.pinoLogger.debug(context || {}, message);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: LogContext): void {
    this.pinoLogger.warn(context || {}, message);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error, context?: LogContext): void {
    const logContext = {
      ...context,
      ...(error && {
        stack: error.stack,
        name: error.name,
      }),
    };
    this.pinoLogger.error(logContext, message);
  }

  /**
   * Log HTTP request
   */
  logRequest(context: LogContext): void {
    const { durationMs, statusCode, method, route, ...rest } = context;
    const level = statusCode && statusCode >= 500 ? 'error' : 'info';

    this.pinoLogger[level](
      {
        type: 'http_request',
        method,
        route,
        statusCode,
        durationMs,
        ...rest,
      },
      `${method} ${route} - ${statusCode} (${durationMs}ms)`,
    );
  }

  /**
   * Get Pino logger for direct use if needed
   */
  getPinoLogger(): PinoLogger {
    return this.pinoLogger;
  }
}
