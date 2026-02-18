/**
 * Configuration loader and validator for BuildingOS API
 * Uses Zod for runtime validation with helpful error messages
 * Runs on application startup
 */

import { z } from 'zod';
import { AppConfig, NodeEnv } from './config.types';

/**
 * Parse a comma-separated string into array
 */
function parseStringArray(value: string): string[] {
  return value.split(',').map((s) => s.trim());
}

/**
 * Parse string boolean
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Zod schema for environment validation
 * Split by env to enforce different requirements
 */
const createConfigSchema = (nodeEnv: string) => {
  const isProduction = nodeEnv === 'production';
  const isStaging = nodeEnv === 'staging';

  return z.object({
    // Server (always required)
    NODE_ENV: z
      .enum(['development', 'staging', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z
      .enum(['debug', 'log', 'warn', 'error'])
      .default('debug'),

    // Database (always required)
    DATABASE_URL: z
      .string()
      .url('DATABASE_URL must be a valid URL')
      .startsWith('postgresql://', 'DATABASE_URL must start with postgresql://')
      .describe('PostgreSQL connection string'),

    // Auth (always required)
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET must be at least 32 characters (use 64+ for production)')
      .describe('Secret key for JWT signing'),
    JWT_EXPIRES_IN: z.string().default('7d'),

    // Frontend URL (always required)
    WEB_ORIGIN: z
      .string()
      .url('WEB_ORIGIN must be a valid URL')
      .describe('CORS origin for frontend requests'),

    // Multi-tenancy
    TENANT_RESOLUTION_MODE: z
      .enum(['path', 'header'])
      .default('path'),
    TENANT_HEADER_NAME: z.string().default('x-tenant-id'),

    // Storage (S3 compatible - always required)
    S3_ENDPOINT: z
      .string()
      .url('S3_ENDPOINT must be a valid URL')
      .describe('S3 or MinIO endpoint'),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY: z
      .string()
      .min(1, 'S3_ACCESS_KEY is required')
      .describe('S3 access key'),
    S3_SECRET_KEY: z
      .string()
      .min(1, 'S3_SECRET_KEY is required')
      .describe('S3 secret key'),
    S3_BUCKET: z
      .string()
      .min(1, 'S3_BUCKET is required')
      .describe('S3 bucket name'),
    S3_FORCE_PATH_STYLE: z.string().transform((v) => parseBoolean(v, true)),
    S3_PUBLIC_BASE_URL: z.string().url('S3_PUBLIC_BASE_URL must be a valid URL'),

    // App base URL (for links in emails)
    APP_BASE_URL: z
      .string()
      .url('APP_BASE_URL must be a valid URL')
      .describe('Base URL for frontend links in emails'),

    // Upload limits
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10485760), // 10MB
    UPLOAD_ALLOWED_MIME: z
      .string()
      .transform(parseStringArray)
      .default(() => parseStringArray('image/jpeg,image/png,application/pdf')),

    // Email
    MAIL_PROVIDER: z
      .enum(['none', 'smtp', 'resend', 'ses'])
      .default('none'),
    MAIL_FROM: z
      .string()
      .default('BuildingOS <no-reply@buildingos.local>'),

    // SMTP (conditional on MAIL_PROVIDER=smtp)
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    // Resend (conditional on MAIL_PROVIDER=resend)
    RESEND_API_KEY: z.string().optional(),

    // Redis (optional, for queue)
    REDIS_URL: z
      .string()
      .url('REDIS_URL must be a valid URL')
      .optional(),

    // Sentry (optional)
    SENTRY_DSN: z
      .string()
      .url('SENTRY_DSN must be a valid URL')
      .optional(),

    // Feature flags
    FEATURE_PORTAL_RESIDENT: z
      .string()
      .transform((v) => parseBoolean(v, true)),
    FEATURE_PAYMENTS_MVP: z
      .string()
      .transform((v) => parseBoolean(v, true)),
  });
};

/**
 * Load and validate configuration from process.env
 * Throws descriptive error if validation fails
 */
export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development') as NodeEnv;

  console.log(`[Config] Loading configuration for environment: ${nodeEnv}`);

  const schema = createConfigSchema(nodeEnv);

  try {
    const parsed = schema.parse(process.env);

    // Additional validation: conditional requirements based on env
    validateConditionalConfig(parsed, nodeEnv);

    const config: AppConfig = {
      // Server
      nodeEnv,
      port: parsed.PORT,
      logLevel: parsed.LOG_LEVEL,

      // Database
      databaseUrl: parsed.DATABASE_URL,

      // Auth
      jwtSecret: parsed.JWT_SECRET,
      jwtExpiresIn: parsed.JWT_EXPIRES_IN,

      // Frontend
      webOrigin: parsed.WEB_ORIGIN,

      // Multi-tenancy
      tenantResolutionMode: parsed.TENANT_RESOLUTION_MODE,
      tenantHeaderName: parsed.TENANT_HEADER_NAME,

      // Storage
      s3Endpoint: parsed.S3_ENDPOINT,
      s3Region: parsed.S3_REGION,
      s3AccessKey: parsed.S3_ACCESS_KEY,
      s3SecretKey: parsed.S3_SECRET_KEY,
      s3Bucket: parsed.S3_BUCKET,
      s3ForcePathStyle: parsed.S3_FORCE_PATH_STYLE,
      s3PublicBaseUrl: parsed.S3_PUBLIC_BASE_URL,

      // App URL
      appBaseUrl: parsed.APP_BASE_URL,

      // Upload
      uploadMaxBytes: parsed.UPLOAD_MAX_BYTES,
      uploadAllowedMime: parsed.UPLOAD_ALLOWED_MIME,

      // Email
      mailProvider: parsed.MAIL_PROVIDER,
      mailFrom: parsed.MAIL_FROM,
      smtpHost: parsed.SMTP_HOST,
      smtpPort: parsed.SMTP_PORT,
      smtpUser: parsed.SMTP_USER,
      smtpPass: parsed.SMTP_PASS,
      resendApiKey: parsed.RESEND_API_KEY,

      // Redis
      redisUrl: parsed.REDIS_URL,

      // Sentry
      sentryDsn: parsed.SENTRY_DSN,

      // Feature flags
      featurePortalResident: parsed.FEATURE_PORTAL_RESIDENT,
      featurePaymentsMvp: parsed.FEATURE_PAYMENTS_MVP,
    };

    logConfigLoaded(config, nodeEnv);
    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('[Config] ❌ Configuration validation failed:');
      error.issues.forEach((err) => {
        const path = err.path.join('.');
        console.error(`  - ${path}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Validate conditional configuration requirements
 */
function validateConditionalConfig(config: any, nodeEnv: NodeEnv): void {
  const errors: string[] = [];

  // Production: stricter requirements
  if (nodeEnv === 'production') {
    if (config.JWT_SECRET.length < 64) {
      errors.push('JWT_SECRET in production must be at least 64 characters');
    }
    if (!config.APP_BASE_URL.startsWith('https://')) {
      errors.push('APP_BASE_URL in production must start with https://');
    }
    if (!config.WEB_ORIGIN.startsWith('https://')) {
      errors.push('WEB_ORIGIN in production must start with https://');
    }
    if (config.DATABASE_URL.includes('localhost') || config.DATABASE_URL.includes('127.0.0.1')) {
      errors.push('DATABASE_URL in production cannot use localhost');
    }
  }

  // Staging: similar to production but slightly relaxed
  if (nodeEnv === 'staging') {
    if (config.JWT_SECRET.length < 48) {
      errors.push('JWT_SECRET in staging must be at least 48 characters');
    }
  }

  // Email validation: if provider is smtp, require SMTP settings
  if (config.MAIL_PROVIDER === 'smtp') {
    if (!config.SMTP_HOST || !config.SMTP_PORT || !config.SMTP_USER || !config.SMTP_PASS) {
      errors.push(
        'MAIL_PROVIDER=smtp requires: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS',
      );
    }
  }

  // Email validation: if provider is resend, require API key
  if (config.MAIL_PROVIDER === 'resend') {
    if (!config.RESEND_API_KEY) {
      errors.push('MAIL_PROVIDER=resend requires: RESEND_API_KEY');
    }
  }

  if (errors.length > 0) {
    console.error('[Config] ❌ Configuration validation failed:');
    errors.forEach((err) => {
      console.error(`  - ${err}`);
    });
    process.exit(1);
  }
}

/**
 * Log sanitized configuration (never log secrets)
 */
function logConfigLoaded(config: AppConfig, nodeEnv: NodeEnv): void {
  console.log(`[Config] ✅ Configuration loaded for ${nodeEnv}:`);
  console.log(`  - Server: port ${config.port}, logLevel=${config.logLevel}`);
  console.log(`  - Database: ${maskUrl(config.databaseUrl)}`);
  console.log(`  - Auth: JWT expires in ${config.jwtExpiresIn}`);
  console.log(`  - Frontend: ${config.webOrigin}`);
  console.log(`  - Storage: ${config.s3Endpoint} (bucket: ${config.s3Bucket})`);
  console.log(`  - Email: ${config.mailProvider}`);
  if (config.redisUrl) {
    console.log(`  - Redis: ${maskUrl(config.redisUrl)}`);
  }
  if (config.sentryDsn) {
    console.log(`  - Sentry: enabled`);
  }
}

/**
 * Mask URL credentials for safe logging
 */
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '***';
  }
}
