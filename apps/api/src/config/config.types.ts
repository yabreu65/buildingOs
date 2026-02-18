/**
 * Configuration types for BuildingOS API
 * Defines all validated environment variables
 */

export type NodeEnv = 'development' | 'staging' | 'production';

export interface AppConfig {
  // Server
  nodeEnv: NodeEnv;
  port: number;
  logLevel: 'debug' | 'log' | 'warn' | 'error';

  // Database
  databaseUrl: string;

  // Auth
  jwtSecret: string;
  jwtExpiresIn: string;

  // CORS / Frontend
  webOrigin: string;

  // Multi-tenancy
  tenantResolutionMode: 'path' | 'header';
  tenantHeaderName: string;

  // Storage (S3 compatible)
  s3Endpoint: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3PublicBaseUrl: string;

  // App URLs
  appBaseUrl: string;

  // Upload limits
  uploadMaxBytes: number;
  uploadAllowedMime: string[];

  // Email
  mailProvider: 'none' | 'smtp' | 'resend' | 'ses';
  mailFrom: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  resendApiKey?: string;

  // Redis (optional, for queue/cache)
  redisUrl?: string;

  // Sentry (optional)
  sentryDsn?: string;

  // Feature flags
  featurePortalResident: boolean;
  featurePaymentsMvp: boolean;
}

/**
 * Which vars are required in which environments
 */
export type ConfigRequirement = 'always' | 'production' | 'staging' | 'optional';
