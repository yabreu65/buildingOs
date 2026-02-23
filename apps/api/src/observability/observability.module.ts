/**
 * Observability Module
 * Centralizes logging, error tracking, and health checks
 */

import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerService } from './logger.service';
import { SentryService } from './sentry.service';
import { RequestIdMiddleware } from './request-id.middleware';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';
import { SentryExceptionFilter } from './sentry-exception.filter';

@Module({
  imports: [AppConfigModule, PrismaModule],
  providers: [
    LoggerService,
    SentryService,
    HealthService,
    {
      provide: APP_FILTER,
      useClass: SentryExceptionFilter,
    },
  ],
  controllers: [HealthController],
  exports: [LoggerService, SentryService, HealthService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply RequestID middleware to all routes
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
