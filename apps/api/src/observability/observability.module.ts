/**
 * Observability Module
 * Centralizes logging, error tracking, and health checks
 */

import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { LoggerService } from './logger.service';
import { SentryService } from './sentry.service';
import { RequestIdMiddleware } from './request-id.middleware';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';

@Module({
  providers: [LoggerService, SentryService, HealthService],
  controllers: [HealthController],
  exports: [LoggerService, SentryService, HealthService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply RequestID middleware to all routes
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
