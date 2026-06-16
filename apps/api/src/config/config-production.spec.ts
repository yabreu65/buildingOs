/**
 * Tests for production readiness config validation
 * Task 1.2: Config validation for payment, email, and AI provider env vars
 */

import { createConfigSchema } from './config';

describe('Production Readiness Config Validation', () => {
  const baseEnv: Record<string, string> = {
    NODE_ENV: 'test',
    PORT: '4000',
    LOG_LEVEL: 'debug',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'a'.repeat(64),
    JWT_EXPIRES_IN: '7d',
    WEB_ORIGIN: 'http://localhost:3000',
    TENANT_RESOLUTION_MODE: 'path',
    TENANT_HEADER_NAME: 'x-tenant-id',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'test-access-key',
    S3_SECRET_KEY: 'test-secret-key',
    S3_BUCKET: 'test-bucket',
    S3_FORCE_PATH_STYLE: 'true',
    S3_PUBLIC_BASE_URL: 'http://localhost:9000/test-bucket',
    APP_BASE_URL: 'http://localhost:3000',
    UPLOAD_MAX_BYTES: '10485760',
    UPLOAD_ALLOWED_MIME: 'image/jpeg,image/png,application/pdf',
    MAIL_PROVIDER: 'none',
    MAIL_FROM: 'test@test.com',
    FEATURE_PORTAL_RESIDENT: 'true',
    FEATURE_PAYMENTS_MVP: 'true',
  };

  describe('PAYMENT_PROVIDER env var', () => {
    it('accepts valid payment provider values', () => {
      const schema = createConfigSchema('test');
      expect(schema.safeParse({ ...baseEnv, PAYMENT_PROVIDER: 'none' }).success).toBe(true);
      expect(schema.safeParse({ ...baseEnv, PAYMENT_PROVIDER: 'mercadopago' }).success).toBe(true);
      expect(schema.safeParse({ ...baseEnv, PAYMENT_PROVIDER: 'stripe' }).success).toBe(true);
    });

    it('rejects invalid payment provider', () => {
      const schema = createConfigSchema('test');
      const result = schema.safeParse({ ...baseEnv, PAYMENT_PROVIDER: 'paypal' });
      expect(result.success).toBe(false);
    });

    it('defaults PAYMENT_PROVIDER to none when not set', () => {
      const schema = createConfigSchema('test');
      const result = schema.parse(baseEnv);
      expect(result.PAYMENT_PROVIDER).toBe('none');
    });
  });

  describe('AI_PROVIDER env var', () => {
    it('accepts none provider', () => {
      const schema = createConfigSchema('test');
      const result = schema.safeParse({ ...baseEnv, AI_PROVIDER: 'none' });
      expect(result.success).toBe(true);
    });

    it('accepts openai provider', () => {
      const schema = createConfigSchema('test');
      const result = schema.safeParse({ ...baseEnv, AI_PROVIDER: 'openai' });
      expect(result.success).toBe(true);
    });

    it('accepts opencode provider', () => {
      const schema = createConfigSchema('test');
      const result = schema.safeParse({ ...baseEnv, AI_PROVIDER: 'opencode' });
      expect(result.success).toBe(true);
    });

    it('accepts ollama provider with URL', () => {
      const schema = createConfigSchema('test');
      const result = schema.safeParse({ ...baseEnv, AI_PROVIDER: 'ollama', AI_OLLAMA_URL: 'http://ollama.local:11434' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid AI provider', () => {
      const schema = createConfigSchema('test');
      const result = schema.safeParse({ ...baseEnv, AI_PROVIDER: 'claude' });
      expect(result.success).toBe(false);
    });

    it('requires AI_OLLAMA_URL when AI_PROVIDER is ollama', () => {
      const schema = createConfigSchema('test');
      const env = { ...baseEnv, AI_PROVIDER: 'ollama' };
      const result = schema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues.map((i) => i.message);
        expect(issues.some((m) => m.includes('AI_OLLAMA_URL'))).toBe(true);
      }
    });

    it('defaults AI_PROVIDER to none when not set', () => {
      const schema = createConfigSchema('test');
      const result = schema.parse(baseEnv);
      expect(result.AI_PROVIDER).toBe('none');
    });

    it('allows AI_OLLAMA_URL to be null by default', () => {
      const schema = createConfigSchema('test');
      const result = schema.parse(baseEnv);
      expect(result.AI_OLLAMA_URL).toBeNull();
    });
  });

  describe('ENABLE_PAYMENT_WEBHOOKS', () => {
    it('accepts boolean string values', () => {
      const schema = createConfigSchema('test');
      expect(schema.safeParse({ ...baseEnv, ENABLE_PAYMENT_WEBHOOKS: 'true' }).success).toBe(true);
      expect(schema.safeParse({ ...baseEnv, ENABLE_PAYMENT_WEBHOOKS: 'false' }).success).toBe(true);
    });

    it('defaults to false when not set', () => {
      const schema = createConfigSchema('test');
      const result = schema.parse(baseEnv);
      expect(result.ENABLE_PAYMENT_WEBHOOKS).toBe(false);
    });

    it('parses true string correctly', () => {
      const schema = createConfigSchema('test');
      const result = schema.parse({ ...baseEnv, ENABLE_PAYMENT_WEBHOOKS: 'true' });
      expect(result.ENABLE_PAYMENT_WEBHOOKS).toBe(true);
    });
  });

  describe('SES config validation', () => {
    it('requires SES_REGION when MAIL_PROVIDER is ses', () => {
      const schema = createConfigSchema('test');
      const result = schema.safeParse({ ...baseEnv, MAIL_PROVIDER: 'ses' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues.map((i) => i.message);
        expect(issues.some((m) => m.includes('SES_REGION'))).toBe(true);
      }
    });

    it('accepts ses provider with all required fields', () => {
      const schema = createConfigSchema('test');
      const result = schema.safeParse({
        ...baseEnv,
        MAIL_PROVIDER: 'ses',
        SES_REGION: 'us-east-1',
        SES_ACCESS_KEY: 'test-key',
        SES_SECRET_KEY: 'test-secret',
      });
      expect(result.success).toBe(true);
    });

    it('requires SES_ACCESS_KEY when MAIL_PROVIDER is ses', () => {
      const schema = createConfigSchema('test');
      const result = schema.safeParse({ ...baseEnv, MAIL_PROVIDER: 'ses', SES_REGION: 'us-east-1', SES_SECRET_KEY: 'secret' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues.map((i) => i.message);
        expect(issues.some((m) => m.includes('SES_ACCESS_KEY'))).toBe(true);
      }
    });

    it('requires SES_SECRET_KEY when MAIL_PROVIDER is ses', () => {
      const schema = createConfigSchema('test');
      const result = schema.safeParse({ ...baseEnv, MAIL_PROVIDER: 'ses', SES_REGION: 'us-east-1', SES_ACCESS_KEY: 'key' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues.map((i) => i.message);
        expect(issues.some((m) => m.includes('SES_SECRET_KEY'))).toBe(true);
      }
    });
  });

  describe('MERCADOPAGO and STRIPE keys are optional', () => {
    it('allows missing mercadopago key when provider is none', () => {
      const schema = createConfigSchema('test');
      const result = schema.parse(baseEnv);
      expect(result.MERCADOPAGO_ACCESS_TOKEN).toBeUndefined();
    });

    it('allows missing stripe key when provider is none', () => {
      const schema = createConfigSchema('test');
      const result = schema.parse(baseEnv);
      expect(result.STRIPE_SECRET_KEY).toBeUndefined();
    });
  });

  describe('OPENAI_API_KEY is optional', () => {
    it('allows missing OPENAI_API_KEY when provider is none', () => {
      const schema = createConfigSchema('test');
      const result = schema.parse(baseEnv);
      expect(result.OPENAI_API_KEY).toBeUndefined();
    });
  });
});