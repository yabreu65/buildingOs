/**
 * Configuration Service
 * Provides access to validated application configuration
 * Usage: inject ConfigService and call get()
 */

import { Injectable, Inject } from '@nestjs/common';
import { AppConfig } from './config.types';

@Injectable()
export class ConfigService {
  constructor(
    @Inject('APP_CONFIG') private readonly appConfig: AppConfig,
  ) {}

  /**
   * Get full configuration object
   */
  get(): AppConfig {
    return this.appConfig;
  }

  /**
   * Get specific config value
   * Usage: configService.get('jwtSecret')
   */
  getValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.appConfig[key];
  }

  /**
   * Check if in production
   */
  isProduction(): boolean {
    return this.appConfig.nodeEnv === 'production';
  }

  /**
   * Check if in staging
   */
  isStaging(): boolean {
    return this.appConfig.nodeEnv === 'staging';
  }

  /**
   * Check if in development
   */
  isDevelopment(): boolean {
    return this.appConfig.nodeEnv === 'development';
  }

  /**
   * Check if feature is enabled
   */
  isFeatureEnabled(feature: 'portalResident' | 'paymentsMvp'): boolean {
    if (feature === 'portalResident') {
      return this.appConfig.featurePortalResident;
    }
    if (feature === 'paymentsMvp') {
      return this.appConfig.featurePaymentsMvp;
    }
    return false;
  }
}
