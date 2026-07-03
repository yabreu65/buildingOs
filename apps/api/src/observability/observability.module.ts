/**
 * Observability Module
 * Centralizes logging, error tracking, and health checks
 */

import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { EmailModule } from '../email/email.module';
import { LoggerService } from './logger.service';
import { SentryService } from './sentry.service';
import { RequestIdMiddleware } from './request-id.middleware';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { SentryExceptionFilter } from './sentry-exception.filter';

@Module({
  imports: [AppConfigModule, PrismaModule, StorageModule, EmailModule],
  providers: [
    LoggerService,
    SentryService,
    HealthService,
    MetricsService,
    {
      provide: APP_FILTER,
      useClass: SentryExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
  controllers: [HealthController, MetricsController],
  exports: [LoggerService, SentryService, HealthService, MetricsService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply RequestID middleware to all routes
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
