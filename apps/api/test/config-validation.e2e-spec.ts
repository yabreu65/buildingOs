import { createConfigSchema } from '../src/config/config';

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'development',
    PORT: '4000',
    LOG_LEVEL: 'debug',
    DATABASE_URL: 'postgresql://buildingos:buildingos@localhost:5432/buildingos?schema=public',
    JWT_SECRET: 'dev-secret-do-not-use-in-prod-needs-32-chars-min',
    JWT_EXPIRES_IN: '7d',
    WEB_ORIGIN: 'http://localhost:3000',
    TENANT_RESOLUTION_MODE: 'path',
    TENANT_HEADER_NAME: 'x-tenant-id',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'buildingos',
    S3_SECRET_KEY: 'buildingos123',
    S3_BUCKET: 'buildingos-dev',
    S3_FORCE_PATH_STYLE: 'true',
    S3_PUBLIC_BASE_URL: 'http://localhost:9000',
    APP_BASE_URL: 'http://localhost:3000',
    UPLOAD_MAX_BYTES: '10485760',
    UPLOAD_ALLOWED_MIME: 'image/jpeg,image/png,application/pdf',
    MAIL_PROVIDER: 'none',
    MAIL_FROM: 'BuildingOS <no-reply@buildingos.local>',
    FEATURE_PORTAL_RESIDENT: 'true',
    FEATURE_PAYMENTS_MVP: 'true',
    ...overrides,
  };
}

describe('Config schema optional/conditional validation', () => {
  it('does not fail when MAIL_PROVIDER=none and SMTP/REDIS/SENTRY are empty', () => {
    const schema = createConfigSchema('development');
    const result = schema.safeParse(
      baseEnv({
        MAIL_PROVIDER: 'none',
        SMTP_PORT: '',
        REDIS_URL: '',
        SENTRY_DSN: '',
      }),
    );

    expect(result.success).toBe(true);
  });

  it('fails clearly when MAIL_PROVIDER=smtp and SMTP_PORT is empty', () => {
    const schema = createConfigSchema('development');
    const result = schema.safeParse(
      baseEnv({
        MAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '',
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(
      result.error.issues.some(
        (issue) =>
          issue.path.join('.') === 'SMTP_PORT'
          && issue.message === 'SMTP_PORT is required when MAIL_PROVIDER=smtp',
      ),
    ).toBe(true);
  });
});
