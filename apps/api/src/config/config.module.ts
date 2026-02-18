/**
 * BuildingOS Configuration Module
 * Loads and validates environment configuration on app startup
 * Makes AppConfig available via dependency injection
 */

import { Module } from '@nestjs/common';
import { loadConfig } from './config';
import { AppConfig } from './config.types';
import { ConfigService } from './config.service';

/**
 * Create config provider - runs on module initialization
 */
export const configProvider = {
  provide: 'APP_CONFIG',
  useFactory: (): AppConfig => {
    return loadConfig();
  },
};

@Module({
  providers: [configProvider, ConfigService],
  exports: [ConfigService, 'APP_CONFIG'],
})
export class AppConfigModule {}
