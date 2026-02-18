# BuildingOS Configuration System

Centralized environment configuration with validation and type safety.

## Overview

All application configuration is loaded from environment variables at startup using Zod for runtime validation. The configuration is validated **before** the application starts, ensuring no missing or invalid settings.

## Files

- **config.ts** - Configuration loader with Zod validation schema
- **config.types.ts** - TypeScript types for configuration
- **config.service.ts** - Injectable service for accessing configuration
- **config.module.ts** - NestJS module that loads and provides configuration

## Architecture

### Loading Flow

```
1. Application starts
2. AppConfigModule loaded (before other modules)
3. loadConfig() executes
   - Reads all environment variables
   - Validates against Zod schema
   - Enforces environment-specific requirements
   - Logs sanitized configuration
4. ConfigService injected into modules that need it
```

### Validation

Configuration is validated with different strictness levels:

| Environment | JWT_SECRET | DATABASE_URL | APP_BASE_URL | NODE_ENV |
|-------------|-----------|--------------|--------------|----------|
| **dev** | 32+ chars | any postgresql:// | any URL | development |
| **staging** | 48+ chars | NO localhost | https:// required | staging |
| **production** | 64+ chars | NO localhost | https:// required | production |

If validation fails, the application exits with detailed error messages:

```
[Config] ❌ Configuration validation failed:
  - DATABASE_URL: String must be valid url
  - JWT_SECRET: String must contain at least 64 character(s)
```

## Usage in Code

### 1. Inject ConfigService

```typescript
import { ConfigService } from '@/config/config.service';

@Injectable()
export class MyService {
  constructor(private config: ConfigService) {}

  doSomething() {
    const secret = this.config.getValue('jwtSecret');
    const isProduction = this.config.isProduction();
  }
}
```

### 2. Use Specific Helpers

```typescript
// Check environment
if (this.config.isProduction()) {
  // Production-only code
}

// Check feature flags
if (this.config.isFeatureEnabled('portalResident')) {
  // Feature-specific code
}

// Get entire config
const fullConfig = this.config.get();
const allSettings = fullConfig;
```

### 3. Access in Configuration

Some services (JWT, S3, Database) already use ConfigService internally.

## Environment Variables

### Critical (Always Required)

| Variable | Example | Notes |
|----------|---------|-------|
| NODE_ENV | `production` | development \| staging \| production |
| DATABASE_URL | `postgresql://user:pass@host/db` | PostgreSQL only |
| JWT_SECRET | `long-random-string-64-chars` | Use `openssl rand -base64 48` |
| S3_ENDPOINT | `https://s3.amazonaws.com` | S3 or MinIO endpoint |
| S3_BUCKET | `buildingos-prod` | Must be unique per environment |
| APP_BASE_URL | `https://buildingos.example.com` | For email links |
| WEB_ORIGIN | `https://buildingos.example.com` | CORS origin |

### Important (Environment-Specific)

- **SMTP_*** - Only required if `MAIL_PROVIDER=smtp`
- **RESEND_API_KEY** - Only required if `MAIL_PROVIDER=resend`
- **REDIS_URL** - Optional, for queues/caching
- **SENTRY_DSN** - Optional, for error tracking

See `.env.example` and `.env.example.staging` for complete lists.

## Configuration by Environment

### Development (.env)

```bash
NODE_ENV="development"
DATABASE_URL="postgresql://user:pass@localhost:5432/buildingos"
JWT_SECRET="dev-secret-32-chars-minimum"
APP_BASE_URL="http://localhost:3000"
WEB_ORIGIN="http://localhost:3000"
S3_BUCKET="buildingos-dev"
MAIL_PROVIDER="none"  # No emails sent
```

**Load with:**
```bash
npm run dev
```

### Staging (.env)

```bash
NODE_ENV="staging"
DATABASE_URL="postgresql://user:pass@staging-db.example.com/buildingos"
JWT_SECRET="staging-secret-48-chars-minimum-random"
APP_BASE_URL="https://staging.buildingos.example.com"
WEB_ORIGIN="https://staging.buildingos.example.com"
S3_BUCKET="buildingos-staging"
MAIL_PROVIDER="resend"
RESEND_API_KEY="re_staging_key"
```

**Load with:**
```bash
NODE_ENV=staging npm start
```

### Production (.env - NEVER COMMIT!)

```bash
NODE_ENV="production"
DATABASE_URL="postgresql://user:pass@prod-db.example.com/buildingos"
JWT_SECRET="production-secret-64-chars-minimum-random-secure"
APP_BASE_URL="https://buildingos.example.com"
WEB_ORIGIN="https://buildingos.example.com"
S3_BUCKET="buildingos-prod"
MAIL_PROVIDER="resend"
RESEND_API_KEY="re_prod_key"
SENTRY_DSN="https://key@sentry.io/project"
```

**Never store in repository!** Use:
- AWS Secrets Manager
- Environment variables in CI/CD
- Server secrets files with `chmod 600`

## Secrets Management

### Never Commit Real Secrets!

```bash
# ❌ BAD
git add .env  # Don't!
cat .env > .env.prod  # Don't!

# ✅ GOOD
echo ".env" >> .gitignore
echo ".env.*.local" >> .gitignore
```

### Safe Approaches

**Option 1: AWS Secrets Manager**
```bash
aws secretsmanager create-secret \
  --name buildingos/prod/config \
  --secret-string '{"DATABASE_URL":"...","JWT_SECRET":"..."}'

# On deploy:
aws secretsmanager get-secret-value \
  --secret-id buildingos/prod/config \
  --query SecretString --output text > .env
```

**Option 2: CI/CD Secrets**
```yaml
# GitHub Actions example
env:
  DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
  JWT_SECRET: ${{ secrets.PROD_JWT_SECRET }}
```

**Option 3: Server Secrets**
```bash
# On production server
echo "DATABASE_URL=..." > /etc/buildingos/.env
chmod 600 /etc/buildingos/.env
```

## Validation Rules

### String Validation

All string env vars are trimmed and required (unless marked optional).

```typescript
JWT_SECRET: z.string().min(32, 'message')
```

### URL Validation

URLs must be valid and have correct protocol:

```typescript
DATABASE_URL: z.string().startsWith('postgresql://', 'message')
APP_BASE_URL: z.string().url().startsWith('https://', 'in production')
```

### Number Validation

Numbers are coerced from strings:

```typescript
PORT: z.coerce.number().int().positive()
UPLOAD_MAX_BYTES: z.coerce.number().int().positive()
```

### Enum Validation

Must match one of allowed values:

```typescript
NODE_ENV: z.enum(['development', 'staging', 'production'])
MAIL_PROVIDER: z.enum(['none', 'smtp', 'resend', 'ses'])
```

### Boolean Validation

Parse string booleans:

```typescript
FEATURE_PORTAL_RESIDENT: z.string().transform((v) => parseBoolean(v, true))
// "true" → true, "false" → false, undefined → true (default)
```

## Testing Configuration

### Unit Tests

```typescript
describe('ConfigService', () => {
  it('should load development config', () => {
    process.env.NODE_ENV = 'development';
    const config = loadConfig();
    expect(config.nodeEnv).toBe('development');
  });

  it('should fail if JWT_SECRET too short in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short';
    expect(() => loadConfig()).toThrow();
  });
});
```

### Manual Testing

```bash
# Test invalid config
unset JWT_SECRET
npm run dev
# Expected: [Config] ❌ Configuration validation failed: JWT_SECRET is required

# Test valid config
export JWT_SECRET="long-enough-secret-with-32-chars"
npm run dev
# Expected: [Config] ✅ Configuration loaded for development

# Check logs show masked secrets
# Expected: JWT Secret is NOT printed, DATABASE_URL shows *** for password
```

## Troubleshooting

### "Configuration validation failed"

Check the error message for which variable is invalid:

```bash
# Missing variable
# → Add to .env or set in environment

# Invalid format
# → Check .env.example for correct format

# Wrong environment requirements
# → Use appropriate .env for your environment
```

### "Cannot find module 'config'"

```bash
# ConfigService not imported
# → Add to module imports:
import { AppConfigModule } from '@/config/config.module';

@Module({
  imports: [AppConfigModule, ...],
})
```

### Secrets in logs

```bash
# Verify no secrets are logged:
grep -i password logs/*.log  # Should be empty
grep -i secret logs/*.log    # Should be empty
grep "buildingos123" logs/*.log  # Should be empty
```

## Best Practices

1. ✅ Always validate critical config on startup
2. ✅ Never commit `.env` files with real secrets
3. ✅ Use separate buckets/databases per environment
4. ✅ Require HTTPS URLs in production
5. ✅ Use strong random secrets (64+ chars for prod)
6. ✅ Log sanitized config (mask passwords/keys)
7. ✅ Fail fast - exit if config is invalid
8. ✅ Document required env vars in README

## Links

- [Zod Documentation](https://zod.dev/)
- [NestJS Configuration](https://docs.nestjs.com/techniques/configuration)
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/)
- [Environment-based Config Best Practices](https://12factor.net/config)
