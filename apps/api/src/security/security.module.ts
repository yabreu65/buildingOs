/**
 * Security Module for BuildingOS
 * Centralizes security-related middleware and services
 */

import { Module } from '@nestjs/common';
import { RateLimitMiddleware } from './rate-limit.middleware';

@Module({
  providers: [RateLimitMiddleware],
  exports: [RateLimitMiddleware],
})
export class SecurityModule {}
