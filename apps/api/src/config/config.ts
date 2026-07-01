/**
 * Configuration loader and validator for BuildingOS API
 * Uses Zod for runtime validation with helpful error messages
 * Runs on application startup
 */

import { z } from 'zod';
import { AppConfig, NodeEnv } from './config.types';

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

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

function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
}

/**
 * Zod schema for environment validation
 * Split by env to enforce different requirements
 */
export const createConfigSchema = (_nodeEnv: string) => {
  // Note: isProduction and isStaging would be used for conditional schema validation

  return z.object({
    // Server (always required)
    NODE_ENV: z
      .enum(['development', 'staging', 'production', 'test'])
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
    SMTP_HOST: z.preprocess(emptyStringToUndefined, z.string().optional()),
    SMTP_PORT: z.preprocess(
      emptyStringToUndefined,
      z.coerce.number().int().positive().optional(),
    ),
    SMTP_USER: z.preprocess(emptyStringToUndefined, z.string().optional()),
    SMTP_PASS: z.preprocess(emptyStringToUndefined, z.string().optional()),

    // Resend (conditional on MAIL_PROVIDER=resend)
    RESEND_API_KEY: z.string().optional(),

    // Marketing emails
    SALES_TEAM_EMAIL: z.preprocess(emptyStringToUndefined, z.string().email().optional()),
    INFO_EMAIL: z.preprocess(emptyStringToUndefined, z.string().email().optional()),

    // Redis (optional, for queue)
    REDIS_URL: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .url('REDIS_URL must be a valid URL')
        .startsWith('redis://', 'REDIS_URL must start with redis://')
        .optional(),
    ),

    // Sentry (optional)
    SENTRY_DSN: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .url('SENTRY_DSN must be a valid URL')
        .optional(),
    ),

    // Feature flags
    FEATURE_PORTAL_RESIDENT: z
      .string()
      .transform((v) => parseBoolean(v, true)),
    FEATURE_PAYMENTS_MVP: z
      .string()
      .transform((v) => parseBoolean(v, true)),
    FEATURE_ENFORCE_URGENT_FOR_WEB_PUSH: z
      .string()
      .optional()
      .transform((v) => parseBoolean(v, true)),
    ENABLE_WEB_PUSH: z
      .string()
      .optional()
      .default('false')
      .transform((v) => parseBoolean(v, false)),

    // Web Push / VAPID (required whenever web push delivery is enabled)
    VAPID_PUBLIC_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
    VAPID_PRIVATE_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
    VAPID_SUBJECT: z.preprocess(emptyStringToUndefined, z.string().optional()),

    // Development overrides (optional)
    INVITATION_EMAIL_OVERRIDE: z.preprocess(
      emptyStringToUndefined,
      z.string().email().optional(),
    ),

    // Payment Gateway
    PAYMENT_PROVIDER: z
      .enum(['none', 'mercadopago', 'stripe'])
      .default('none'),
    MERCADOPAGO_ACCESS_TOKEN: z.preprocess(emptyStringToUndefined, z.string().optional()),
    MERCADOPAGO_WEBHOOK_SECRET: z.preprocess(emptyStringToUndefined, z.string().optional()),
    STRIPE_SECRET_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
    ENABLE_PAYMENT_WEBHOOKS: z
      .string()
      .optional()
      .default('false')
      .transform((v) => parseBoolean(v, false)),

    // SES email (conditional on MAIL_PROVIDER=ses)
    SES_REGION: z.preprocess(emptyStringToUndefined, z.string().optional()),
    SES_ACCESS_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
    SES_SECRET_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),

    // AI Provider
    AI_PROVIDER: z
      .enum(['none', 'openai', 'opencode', 'ollama', 'gemini'])
      .default('none'),
    AI_OLLAMA_URL: z.preprocess(
      emptyStringToUndefined,
      z.string().url().nullable().optional().transform(v => v ?? null),
    ),
    OPENAI_API_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
    GEMINI_API_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
  }).superRefine((data, ctx) => {
    if (data.MAIL_PROVIDER === 'smtp') {
      if (!data.SMTP_HOST) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_HOST'],
          message: 'SMTP_HOST is required when MAIL_PROVIDER=smtp',
        });
      }
      if (!data.SMTP_PORT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_PORT'],
          message: 'SMTP_PORT is required when MAIL_PROVIDER=smtp',
        });
      }
      if (!data.SMTP_USER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_USER'],
          message: 'SMTP_USER is required when MAIL_PROVIDER=smtp',
        });
      }
      if (!data.SMTP_PASS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_PASS'],
          message: 'SMTP_PASS is required when MAIL_PROVIDER=smtp',
        });
      }
    }

    // SES requires region, access key, and secret key
    if (data.MAIL_PROVIDER === 'ses') {
      if (!data.SES_REGION) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SES_REGION'],
          message: 'SES_REGION is required when MAIL_PROVIDER=ses',
        });
      }
      if (!data.SES_ACCESS_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SES_ACCESS_KEY'],
          message: 'SES_ACCESS_KEY is required when MAIL_PROVIDER=ses',
        });
      }
      if (!data.SES_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SES_SECRET_KEY'],
          message: 'SES_SECRET_KEY is required when MAIL_PROVIDER=ses',
        });
      }
    }

    // AI_PROVIDER=ollama requires AI_OLLAMA_URL
    if (data.AI_PROVIDER === 'ollama' && !data.AI_OLLAMA_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_OLLAMA_URL'],
        message: 'AI_OLLAMA_URL is required when AI_PROVIDER=ollama',
      });
    }

    // AI_PROVIDER=gemini requires GEMINI_API_KEY
    if (data.AI_PROVIDER === 'gemini' && !data.GEMINI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY is required when AI_PROVIDER=gemini',
      });
    }

    if (
      data.PAYMENT_PROVIDER === 'mercadopago' &&
      data.ENABLE_PAYMENT_WEBHOOKS &&
      !data.MERCADOPAGO_WEBHOOK_SECRET
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MERCADOPAGO_WEBHOOK_SECRET'],
        message:
          'MERCADOPAGO_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=mercadopago and ENABLE_PAYMENT_WEBHOOKS=true',
      });
    }

    if (data.ENABLE_WEB_PUSH) {
      validateWebPushVapidConfig(data, ctx);
    }
  });
};

interface WebPushVapidValidationInput {
  readonly VAPID_PUBLIC_KEY?: string;
  readonly VAPID_PRIVATE_KEY?: string;
  readonly VAPID_SUBJECT?: string;
}

function validateWebPushVapidConfig(
  data: WebPushVapidValidationInput,
  ctx: z.RefinementCtx,
): void {
  if (!data.VAPID_PUBLIC_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['VAPID_PUBLIC_KEY'],
      message: 'VAPID_PUBLIC_KEY is required when ENABLE_WEB_PUSH=true',
    });
  } else if (!isValidVapidKey(data.VAPID_PUBLIC_KEY)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['VAPID_PUBLIC_KEY'],
      message: 'VAPID_PUBLIC_KEY must be URL-safe base64 without whitespace',
    });
  }

  if (!data.VAPID_PRIVATE_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['VAPID_PRIVATE_KEY'],
      message: 'VAPID_PRIVATE_KEY is required when ENABLE_WEB_PUSH=true',
    });
  } else if (!isValidVapidKey(data.VAPID_PRIVATE_KEY)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['VAPID_PRIVATE_KEY'],
      message: 'VAPID_PRIVATE_KEY must be URL-safe base64 without whitespace',
    });
  }

  if (!data.VAPID_SUBJECT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['VAPID_SUBJECT'],
      message: 'VAPID_SUBJECT is required when ENABLE_WEB_PUSH=true',
    });
  } else if (!isValidVapidSubject(data.VAPID_SUBJECT)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['VAPID_SUBJECT'],
      message: 'VAPID_SUBJECT must be a mailto: address or non-localhost https URL',
    });
  }
}

function isValidVapidKey(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function isValidVapidSubject(value: string): boolean {
  const subject = value.trim();
  if (subject.startsWith('mailto:')) {
    return subject.length > 'mailto:'.length;
  }

  if (!subject.startsWith('https://')) {
    return false;
  }

  try {
    const parsed = new URL(subject);
    return parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1';
  } catch {
    return false;
  }
}

type ParsedConfig = z.infer<ReturnType<typeof createConfigSchema>>;

/**
 * Load and validate configuration from process.env
 * Throws descriptive error if validation fails
 */
export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development') as NodeEnv;

  writeStdout(`[Config] Loading configuration for environment: ${nodeEnv}`);

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
      salesTeamEmail: parsed.SALES_TEAM_EMAIL,
      infoEmail: parsed.INFO_EMAIL,

      // Redis
      redisUrl: parsed.REDIS_URL,

      // Sentry
      sentryDsn: parsed.SENTRY_DSN,

      // Feature flags
      featurePortalResident: parsed.FEATURE_PORTAL_RESIDENT,
      featurePaymentsMvp: parsed.FEATURE_PAYMENTS_MVP,
      featureEnforceUrgentForWebPush: parsed.FEATURE_ENFORCE_URGENT_FOR_WEB_PUSH,
      enableWebPush: parsed.ENABLE_WEB_PUSH,

      // Web Push
      vapidPublicKey: parsed.VAPID_PUBLIC_KEY,
      vapidPrivateKey: parsed.VAPID_PRIVATE_KEY,
      vapidSubject: parsed.VAPID_SUBJECT,

      // Development overrides
      invitationEmailOverride: parsed.INVITATION_EMAIL_OVERRIDE,

      // Payment Gateway
      paymentProvider: parsed.PAYMENT_PROVIDER,
      mercadopagoAccessToken: parsed.MERCADOPAGO_ACCESS_TOKEN,
      mercadopagoWebhookSecret: parsed.MERCADOPAGO_WEBHOOK_SECRET,
      stripeSecretKey: parsed.STRIPE_SECRET_KEY,
      enablePaymentWebhooks: parsed.ENABLE_PAYMENT_WEBHOOKS,

      // SES
      sesRegion: parsed.SES_REGION,
      sesAccessKey: parsed.SES_ACCESS_KEY,
      sesSecretKey: parsed.SES_SECRET_KEY,

      // AI Provider
      aiProvider: parsed.AI_PROVIDER,
      aiOllamaUrl: parsed.AI_OLLAMA_URL,
      openaiApiKey: parsed.OPENAI_API_KEY,
      geminiApiKey: parsed.GEMINI_API_KEY,
    };

    logConfigLoaded(config, nodeEnv);
    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      writeStderr('[Config] ❌ Configuration validation failed:');
      error.issues.forEach((err) => {
        const path = err.path.join('.');
        writeStderr(`  - ${path}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Validate conditional configuration requirements
 */
function validateConditionalConfig(config: ParsedConfig, nodeEnv: NodeEnv): void {
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
    if (
      config.APP_BASE_URL.includes('localhost') ||
      config.APP_BASE_URL.includes('127.0.0.1')
    ) {
      errors.push('APP_BASE_URL in production cannot use localhost');
    }
    if (
      config.WEB_ORIGIN.includes('localhost') ||
      config.WEB_ORIGIN.includes('127.0.0.1')
    ) {
      errors.push('WEB_ORIGIN in production cannot use localhost');
    }
    if (config.DATABASE_URL.includes('localhost') || config.DATABASE_URL.includes('127.0.0.1')) {
      errors.push('DATABASE_URL in production cannot use localhost');
    }
    if (
      config.S3_ENDPOINT.includes('localhost') ||
      config.S3_ENDPOINT.includes('127.0.0.1')
    ) {
      errors.push('S3_ENDPOINT in production cannot use localhost');
    }
    if (!config.REDIS_URL) {
      errors.push('REDIS_URL is required in production');
    } else if (
      config.REDIS_URL.includes('localhost') ||
      config.REDIS_URL.includes('127.0.0.1')
    ) {
      errors.push('REDIS_URL in production cannot use localhost');
    }
    // NOTE: SENTRY_DSN is optional — SentryService self-disables when absent.
    // NOTE: MAIL_PROVIDER=none is valid — legacy EmailService reports skipped sends.
  }

  // Staging: similar to production but slightly relaxed
  if (nodeEnv === 'staging') {
    if (config.JWT_SECRET.length < 48) {
      errors.push('JWT_SECRET in staging must be at least 48 characters');
    }
  }

  // Email validation: if provider is resend, require API key
  if (config.MAIL_PROVIDER === 'resend') {
    if (!config.RESEND_API_KEY) {
      errors.push('MAIL_PROVIDER=resend requires: RESEND_API_KEY');
    }
  }

  if (errors.length > 0) {
    writeStderr('[Config] ❌ Configuration validation failed:');
    errors.forEach((err) => {
      writeStderr(`  - ${err}`);
    });
    process.exit(1);
  }
}

/**
 * Log sanitized configuration (never log secrets)
 */
function logConfigLoaded(config: AppConfig, nodeEnv: NodeEnv): void {
  writeStdout(`[Config] ✅ Configuration loaded for ${nodeEnv}:`);
  writeStdout(`  - Server: port ${config.port}, logLevel=${config.logLevel}`);
  writeStdout(`  - Database: ${maskUrl(config.databaseUrl)}`);
  writeStdout(`  - Auth: JWT expires in ${config.jwtExpiresIn}`);
  writeStdout(`  - Frontend: ${config.webOrigin}`);
  writeStdout(`  - Storage: ${config.s3Endpoint} (bucket: ${config.s3Bucket})`);
  writeStdout(`  - Email: ${config.mailProvider}`);
  writeStdout(`  - Web Push: ${config.enableWebPush ? 'enabled' : 'disabled'}`);
  writeStdout(`  - Payment: ${config.paymentProvider}`);
  writeStdout(`  - AI: ${config.aiProvider}`);
  if (config.redisUrl) {
    writeStdout(`  - Redis: ${maskUrl(config.redisUrl)}`);
  }
  if (config.sentryDsn) {
    writeStdout('  - Sentry: enabled');
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
