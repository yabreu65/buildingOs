/**
 * Tests for production readiness config validation
 * Task 1.2: Config validation for payment, email, and AI provider env vars
 */

import { createConfigSchema } from './config';

describe('Production Readiness Config Validation', () => {
  const baseEnv = {
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
      for (const provider of ['none', 'mercadopago', 'stripe']) {
        const env = { ...baseEnv, PAYMENT_PROVIDER: provider };
        const result = schema.safeParse(env);
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid payment provider', () => {
      const schema = createConfigSchema('test');
      const env = { ...baseEnv, PAYMENT_PROVIDER: 'paypal' };
      const result = schema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('defaults PAYMENT_PROVIDER to none when not set', () => {
      const schema = createConfigSchema('test');
      const result = schema.parse(baseEnv);
      expect(result.PAYMENT_PROVIDER).toBe('none');
    });
  });

  describe('AI_PROVIDER env var', () => {
    it('accepts valid AI provider values', () => {
      const schema = createConfigSchema('test');

      // none provider
      const noneEnv = { ...baseEnv, AI_PROVIDER: 'none' };
      const noneResult = schema.safeParse(noneEnv);
      expect(noneResult.success).toBe(true);

      // openai provider
      const openaiEnv = { ...baseEnv, AI_PROVIDER: 'openai' };
      const openaiResult = schema.safeParse(openaiEnv);
      if (!openaiResult.success) {
        fail(`openai provider failed: ${JSON.stringify(openaiResult.error.issues)}`);
      }

      // opencode provider
      const opencodeEnv = { ...baseEnv, AI_PROVIDER: 'opencode' };
      const opencodeResult = schema.safeParse(opencodeEnv);
      if (!opencodeResult.success) {
        fail(`opencode provider failed: ${JSON.stringify(opencodeResult.error.issues)}`);
      }
    });

    it('rejects invalid AI provider', () => {
      const schema = createConfigSchema('test');
      const env = { ...baseEnv, AI_PROVIDER: 'claude' };
      const result = schema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('requires AI_OLLAMA_URL when AI_PROVIDER is ollama', () => {
      const schema = createConfigSchema('test');
      const env = { ...baseEnv, AI_PROVIDER: 'ollama' };
      // No AI_OLLAMA_URL set
      const result = schema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues.map((i) => i.message);
        expect(issues.some((m) => m.includes('AI_OLLAMA_URL'))).toBe(true);
      }
    });

    it('accepts ollama provider when AI_OLLAMA_URL is set', () => {
      const schema = createConfigSchema('test');
      const env = { ...baseEnv, AI_PROVIDER: 'ollama', AI_OLLAMA_URL: 'http://ollama.local:11434' };
      const result = schema.safeParse(env);
      expect(result.success).toBe(true);
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
      const envEnabled = { ...baseEnv, ENABLE_PAYMENT_WEBHOOKS: 'true' };
      const envDisabled = { ...baseEnv, ENABLE_PAYMENT_WEBHOOKS: 'false' };
      expect(schema.safeParse(envEnabled).success).toBe(true);
      expect(schema.safeParse(envDisabled).success).toBe(true);
    });

    it('defaults to false when not set', () => {
      const schema = createConfigSchema('test');
      const result = schema.parse(baseEnv);
      expect(result.ENABLE_PAYMENT_WEBHOOKS).toBe(false);
    });

    it('parses true string correctly', () => {
      const schema = createConfigSchema('test');
      const env = { ...baseEnv, ENABLE_PAYMENT_WEBHOOKS: 'true' };
      const result = schema.parse(env);
      expect(result.ENABLE_PAYMENT_WEBHOOKS).toBe(true);
    });
  });

  describe('SES config validation', () => {
    it('requires SES_REGION when MAIL_PROVIDER is ses', () => {
      const schema = createConfigSchema('test');
      const env = { ...baseEnv, MAIL_PROVIDER: 'ses' };
      const result = schema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues.map((i) => i.message);
        expect(issues.some((m) => m.includes('SES_REGION'))).toBe(true);
      }
    });

    it('accepts ses provider with all required fields', () => {
      const schema = createConfigSchema('test');
      const env = {
        ...baseEnv,
        MAIL_PROVIDER: 'ses',
        SES_REGION: 'us-east-1',
        SES_ACCESS_KEY: 'test-key',
        SES_SECRET_KEY: 'test-secret',
      };
      const result = schema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('requires SES_ACCESS_KEY when MAIL_PROVIDER is ses', () => {
      const schema = createConfigSchema('test');
      const env = { ...baseEnv, MAIL_PROVIDER: 'ses', SES_REGION: 'us-east-1', SES_SECRET_KEY: 'secret' };
      const result = schema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues.map((i) => i.message);
        expect(issues.some((m) => m.includes('SES_ACCESS_KEY'))).toBe(true);
      }
    });

    it('requires SES_SECRET_KEY when MAIL_PROVIDER is ses', () => {
      const schema = createConfigSchema('test');
      const env = { ...baseEnv, MAIL_PROVIDER: 'ses', SES_REGION: 'us-east-1', SES_ACCESS_KEY: 'key' };
      const result = schema.safeParse(env);
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