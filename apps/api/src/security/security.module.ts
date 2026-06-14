/**
 * Security Module for BuildingOS
 * Centralizes security-related middleware and services
 */

import { Module } from '@nestjs/common';
import { RateLimitMiddleware } from './rate-limit.middleware';
import { RedisModule } from '../redis/redis.module';
import { AppConfigModule } from '../config/config.module';

@Module({
  imports: [RedisModule, AppConfigModule],
  providers: [RateLimitMiddleware],
  exports: [RateLimitMiddleware],
})
export class SecurityModule {}
