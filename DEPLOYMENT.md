# BuildingOS - Deployment Guide

Complete guide for deploying BuildingOS to staging and production environments with configuration management, database migrations, and rollback strategies.

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Configuration Management](#configuration-management)
4. [Database Migrations](#database-migrations)
5. [Staging Deployment](#staging-deployment)
6. [Production Deployment](#production-deployment)
7. [Seed Data](#seed-data)
8. [Verification Checklist](#verification-checklist)
9. [Rollback Procedures](#rollback-procedures)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools

- **Node.js**: v18+ (verify with `node --version`)
- **npm**: v9+ (verify with `npm --version`)
- **Prisma CLI**: installed as dev dependency
- **Docker** (for local MinIO, if using it)
- **PostgreSQL**: client tools (psql) for database backups
- **AWS CLI** (if deploying to AWS): configured with appropriate credentials

### Required Access

- ✅ PostgreSQL connection strings (development, staging, production)
- ✅ S3/MinIO credentials (development, staging, production - separate!)
- ✅ SMTP or email service API keys
- ✅ JWT secret generation capability
- ✅ SSH/deployment tool access to servers (EC2, Heroku, Railway, etc.)

---

## Environment Setup

### 1. Development Environment (Local)

#### Step 1: Install Dependencies

```bash
cd /path/to/buildingos

# Root dependencies
npm install

# Install all workspace packages
npm install --workspaces
```

#### Step 2: Configure .env (Development)

```bash
cd apps/api

# Copy example to .env
cp .env.example .env

# Edit .env with local settings
# - DATABASE_URL: local PostgreSQL
# - JWT_SECRET: any 32+ char string
# - S3_* : MinIO local credentials
# - Others: localhost URLs
```

#### Step 3: Set Up Local Database

```bash
cd apps/api

# Create PostgreSQL database (if not exists)
createdb buildingos

# Generate Prisma client
npm run prisma:generate

# Run initial migration
npm run migrate

# Seed with development data (OPTIONAL)
npm run seed
```

#### Step 4: Set Up Storage (MinIO - Optional)

```bash
# Start MinIO in Docker
docker run -d \
  --name minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=buildingos \
  -e MINIO_ROOT_PASSWORD=buildingos123 \
  minio/minio server /data --console-address ":9001"

# Create bucket via web console at http://localhost:9001
# - Username: buildingos
# - Password: buildingos123
# - Create bucket: buildingos-dev
```

#### Step 5: Start Development Servers

```bash
# Terminal 1: API
cd apps/api
npm run dev

# Terminal 2: Web
cd apps/web
npm run dev

# Open http://localhost:3000
```

---

## Configuration Management

### Configuration Validation

All configuration is validated on application startup using **Zod schemas**. If any required variable is missing or invalid, the application will fail with a clear error message.

#### Environment Variables by Type

| Variable | Required | Type | Development | Staging | Production |
|----------|----------|------|-------------|---------|-----------|
| NODE_ENV | Yes | enum | "development" | "staging" | "production" |
| DATABASE_URL | Yes | URL | local | staging RDS | prod RDS |
| JWT_SECRET | Yes | string | 32+ chars | 48+ chars | 64+ chars |
| S3_BUCKET | Yes | string | buildingos-dev | buildingos-staging | buildingos-prod |
| APP_BASE_URL | Yes | URL | http://localhost:3000 | https://staging.xxx | https://buildingos.xxx |
| MAIL_PROVIDER | No | enum | "none" | "resend"/"smtp" | "resend"/"ses" |

### Configuration Examples

#### Development (.env)

```bash
NODE_ENV="development"
DATABASE_URL="postgresql://user:pass@localhost:5432/buildingos"
JWT_SECRET="dev-secret-do-not-use-in-prod-needs-32-chars-min"
S3_BUCKET="buildingos-dev"
APP_BASE_URL="http://localhost:3000"
WEB_ORIGIN="http://localhost:3000"
MAIL_PROVIDER="none"
```

#### Staging (.env)

```bash
NODE_ENV="staging"
DATABASE_URL="postgresql://user:staging_pass@staging-db.example.com:5432/buildingos_staging"
JWT_SECRET="YOUR_STAGING_SECRET_64_CHARS_RANDOM_VALUE_GENERATED_SECURELY"
S3_ENDPOINT="https://s3.amazonaws.com"
S3_BUCKET="buildingos-staging"
APP_BASE_URL="https://staging.buildingos.example.com"
WEB_ORIGIN="https://staging.buildingos.example.com"
MAIL_PROVIDER="resend"
RESEND_API_KEY="re_staging_api_key"
```

#### Production (.env)

```bash
NODE_ENV="production"
DATABASE_URL="postgresql://user:prod_pass@prod-db.example.com:5432/buildingos_prod"
JWT_SECRET="YOUR_PRODUCTION_SECRET_64_CHARS_RANDOM_VALUE_STORED_IN_SECRETS_MANAGER"
S3_ENDPOINT="https://s3.amazonaws.com"
S3_BUCKET="buildingos-prod"
APP_BASE_URL="https://buildingos.example.com"
WEB_ORIGIN="https://buildingos.example.com"
MAIL_PROVIDER="resend"
RESEND_API_KEY="re_production_api_key"
SENTRY_DSN="https://key@sentry.io/project"
```

### Secrets Management Best Practices

**NEVER commit .env files with real credentials!**

#### Recommended Approach

1. **AWS Secrets Manager** (recommended for cloud deployments):
   ```bash
   # Store secret
   aws secretsmanager create-secret \
     --name buildingos/prod/config \
     --secret-string '{"DATABASE_URL":"...", "JWT_SECRET":"..."}'

   # Retrieve and inject into environment
   aws secretsmanager get-secret-value --secret-id buildingos/prod/config
   ```

2. **Environment-Specific .env Files** (for direct servers):
   - Create `.env.staging` and `.env.prod` files
   - Store on server with restricted permissions: `chmod 600 .env`
   - Git-ignore all `.env*` files

3. **CI/CD Secrets** (GitHub Actions, GitLab CI, etc.):
   - Store in platform secrets management
   - Inject at build/deploy time: `echo $SECRET_VAR > .env`

---

## Database Migrations

### Prisma Migration Workflow

#### Development: Add/Modify Schema

```bash
cd apps/api

# Edit prisma/schema.prisma with your changes

# Create and apply migration
npm run migrate
# Creates timestamped migration file in prisma/migrations/

# Review generated SQL in prisma/migrations/[timestamp]/migration.sql

# Generate Prisma client
npm run prisma:generate
```

#### Staging/Production: Deploy Migrations

```bash
cd apps/api

# Review pending migrations
npm run migrate:status

# Apply migrations (NO schema edits allowed!)
npm run migrate:deploy
```

### Safe Migration Practices

1. **Always backup database before migration**:
   ```bash
   # PostgreSQL
   pg_dump -h db.example.com -U user buildingos_prod > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Test on staging first**:
   ```bash
   # Apply same migration to staging database
   NODE_ENV=staging npm run migrate:deploy
   ```

3. **Never edit applied migrations**:
   - Applied migrations are immutable
   - Create new migration to fix issues: `npm run migrate`

4. **Dangerous migrations** (require testing):
   - Column drops
   - Renaming tables/columns
   - Data type changes
   - Constraint additions

---

## Staging Deployment

### Step 1: Prepare Environment

```bash
# Clone repository (or pull latest)
git clone https://github.com/yourorg/buildingos.git
cd buildingos

# Create/update .env.staging
cat > apps/api/.env.staging << 'EOF'
NODE_ENV="staging"
DATABASE_URL="YOUR_STAGING_DB_URL"
JWT_SECRET="YOUR_STAGING_JWT_SECRET_64_CHARS"
S3_BUCKET="buildingos-staging"
APP_BASE_URL="https://staging.buildingos.example.com"
WEB_ORIGIN="https://staging.buildingos.example.com"
MAIL_PROVIDER="resend"
RESEND_API_KEY="YOUR_STAGING_RESEND_KEY"
EOF

chmod 600 apps/api/.env.staging
```

### Step 2: Install Dependencies

```bash
npm install --workspaces
```

### Step 3: Build

```bash
# API
cd apps/api
npm run build
# Check for build errors/TypeScript issues

# Web
cd apps/web
npm run build
# Check for build errors/warnings
```

### Step 4: Database Migration

```bash
cd apps/api

# Verify migration status
npm run migrate:status

# Apply all pending migrations
npm run migrate:deploy

# Verify success (no errors should appear)
```

### Step 5: Seed Data (Staging Only)

```bash
cd apps/api

# Seed staging database with test data
npm run seed:staging
# This will create test tenants, buildings, units, etc.
```

### Step 6: Deploy Services

#### Option A: Docker Container

```bash
# Build image
docker build -t buildingos-api:staging .

# Push to registry (if needed)
docker push myregistry.example.com/buildingos-api:staging

# Deploy (example with Docker Compose)
docker-compose -f docker-compose.staging.yml up -d
```

#### Option B: Direct Deployment (Railway, Heroku, EC2)

```bash
# Option 1: Railway
railway deploy

# Option 2: Heroku
git push heroku main:main

# Option 3: EC2/VPS
pm2 start ecosystem.config.js --env staging
```

### Step 7: Verify Deployment

```bash
# Check API health
curl https://staging.buildingos.example.com/health

# Expected response:
# {"status":"ok","timestamp":"2026-02-18T..."}

# Check logs
# tail -f logs/staging.log
```

---

## Production Deployment

### ⚠️ Pre-Deployment Checklist

- [ ] All tests pass: `npm test`
- [ ] No TypeScript errors: `npm run build`
- [ ] Git tag created: `git tag -a v1.2.3 -m "Release 1.2.3"`
- [ ] Database backup verified
- [ ] Staging deployment tested and verified
- [ ] Rollback plan documented
- [ ] All team members notified
- [ ] Monitoring/alerts configured

### Step 1: Environment Preparation

```bash
# Ensure you're deploying from stable branch
git checkout main
git pull origin main

# Create .env with production secrets
# IMPORTANT: Store securely, NEVER commit!
# Use AWS Secrets Manager or similar
```

### Step 2: Build & Test

```bash
npm install --workspaces

# Build API
cd apps/api
npm run build
npm test  # Run test suite

# Build Web
cd apps/web
npm run build

# Check bundle size
npm run build -- --analyze
```

### Step 3: Backup Database

```bash
# Create full backup BEFORE any changes
pg_dump \
  -h prod-db.example.com \
  -U postgres \
  -d buildingos_prod \
  --verbose \
  -Fc > ./backups/buildingos_prod_$(date +%Y%m%d_%H%M%S).dump

# Verify backup
pg_restore -l ./backups/buildingos_prod_*.dump | head -20
```

### Step 4: Apply Database Migrations

```bash
cd apps/api

# Review what will be applied
npm run migrate:status

# Apply migrations
npm run migrate:deploy

# Verify (should see "All migrations have been applied")
```

### Step 5: Deploy Application

```bash
# API
docker push myregistry.example.com/buildingos-api:v1.2.3
kubectl set image deployment/buildingos-api \
  buildingos-api=myregistry.example.com/buildingos-api:v1.2.3

# Web (CDN deployment, S3 + CloudFront, etc.)
npm run build
npm run deploy:prod  # Your deployment script
```

### Step 6: Post-Deployment Verification

```bash
# 1. Health check
curl https://buildingos.example.com/health

# 2. Verify database connectivity
# (check logs for successful connections)

# 3. Test critical workflows
# - Login
# - Create building/unit
# - Upload document

# 4. Monitor error logs
# - Check Sentry dashboard
# - Check CloudWatch/application logs

# 5. Monitor performance
# - Response times
# - Database query performance
# - API rate limiting
```

### Step 7: Smoke Tests

```bash
# Automated smoke tests (if available)
npm run test:smoke:prod

# Manual tests (critical paths):
# 1. User login with valid credentials
# 2. Create new building (should succeed)
# 3. Upload document (should store in S3 prod bucket)
# 4. Create tenant (super-admin only)
# 5. Generate report (if available)
```

---

## Seed Data

### Development Seed

Creates realistic test data for local development:

```bash
cd apps/api
npm run seed

# Creates:
# - 2 test tenants (Tenant A, Tenant B)
# - Multiple buildings per tenant
# - Units with occupants
# - Sample tickets, payments, documents
# - Test users with different roles
```

### Staging Seed

Creates isolated test data for staging environment:

```bash
cd apps/api
npm run seed:staging

# Creates same test data as development
# BUT: respects environment-specific settings
# - No real user data
# - Test email addresses only
```

### IMPORTANT: Never Seed Production!

```bash
# NEVER run seed in production!
# If you do: immediately restore from backup

# The seed script should have safety checks:
if (process.env.NODE_ENV === 'production') {
  throw new Error('Cannot seed production database!');
}
```

### Custom Seed Data

To add custom seed data, edit `apps/api/prisma/seed.ts`:

```typescript
async function main() {
  // Example: create test tenant
  const tenant = await prisma.tenant.create({
    data: {
      name: 'My Test Tenant',
      slug: 'test-tenant',
      // ... other fields
    },
  });

  console.log(`Created tenant: ${tenant.id}`);
}
```

---

## Verification Checklist

### Pre-Deployment

- [ ] Code review completed
- [ ] All tests passing
- [ ] No TypeScript errors
- [ ] Database migrations reviewed
- [ ] Environment variables documented
- [ ] Security scan completed (if applicable)
- [ ] Dependencies up to date
- [ ] Changelog updated

### Post-Deployment (Staging)

- [ ] API responds to health check
- [ ] Database migrations applied successfully
- [ ] Login works
- [ ] Create building works
- [ ] Upload document works
- [ ] No errors in logs
- [ ] Performance acceptable

### Post-Deployment (Production)

- [ ] API health check passes
- [ ] Database is responsive
- [ ] Critical workflows functional
- [ ] No error spikes in Sentry/monitoring
- [ ] Performance metrics normal
- [ ] Team notified of deployment success
- [ ] Documentation updated

---

## Rollback Procedures

### Scenario 1: Database Migration Failed

```bash
# 1. Check migration status
npm run migrate:status

# 2. Identify failing migration
# Look for migration marked "Pending"

# 3. Review the SQL in prisma/migrations/[timestamp]/migration.sql

# 4. Restore from backup
pg_restore -d buildingos_prod ./backups/buildingos_prod_backup.dump

# 5. Fix migration and re-apply
# - Edit Prisma schema
# - Create new migration: npm run migrate
# - Test locally
# - Re-deploy: npm run migrate:deploy
```

### Scenario 2: Application Deployment Failed

```bash
# 1. Identify issue from logs

# 2. Revert to previous image
docker set image deployment/buildingos-api \
  buildingos-api=myregistry.example.com/buildingos-api:v1.2.2

# 3. OR: Revert git and redeploy
git revert v1.2.3
git push origin main
# (if auto-deploy on push is enabled)

# 4. Verify rollback
curl https://buildingos.example.com/health
```

### Scenario 3: Data Corruption

```bash
# 1. Stop application (prevent further writes)
kubectl scale deployment buildingos-api --replicas=0

# 2. Restore database from backup
pg_restore -d buildingos_prod ./backups/buildingos_prod_latest.dump

# 3. Verify data integrity
psql -d buildingos_prod -c "SELECT COUNT(*) FROM tenants;"

# 4. Restart application
kubectl scale deployment buildingos-api --replicas=3

# 5. Run post-deployment verification
```

### Zero-Downtime Rollback (Kubernetes)

```bash
# 1. Check rollout history
kubectl rollout history deployment/buildingos-api

# 2. Rollback to previous version
kubectl rollout undo deployment/buildingos-api

# 3. Monitor rollback progress
kubectl rollout status deployment/buildingos-api

# 4. Verify
curl https://buildingos.example.com/health
```

---

## Troubleshooting

### Configuration Errors

#### Error: "DATABASE_URL is required"

```
❌ Configuration validation failed:
  - DATABASE_URL: String must be valid url
```

**Solution:**
```bash
# Check .env file
cat apps/api/.env | grep DATABASE_URL

# Verify it's a valid PostgreSQL URL
# postgresql://user:password@host:port/database?schema=public

# Restart application
npm run dev
```

#### Error: "JWT_SECRET must be at least 32 characters"

```
❌ JWT_SECRET must be at least 32 characters
  - Production: 64+ characters required
```

**Solution:**
```bash
# Generate secure secret
openssl rand -base64 48

# Update .env with the generated value
# Restart application
```

### Database Migration Errors

#### Error: "Foreign key constraint fails"

```
error: insert or update on table "units" violates foreign key constraint
```

**Solution:**
```bash
# 1. Check what's in the migration file
cat apps/api/prisma/migrations/[timestamp]/migration.sql

# 2. Verify related data exists
# psql -d buildingos -c "SELECT * FROM buildings WHERE id = 'xxx';"

# 3. Adjust data or migration and rerun
npm run migrate
```

#### Error: "Pending migrations detected"

**Solution:**
```bash
# Deploy pending migrations
npm run migrate:deploy

# If deployment isn't possible yet:
npm run migrate:status  # See what's pending

# Once ready to deploy:
npm run migrate:deploy
```

### S3/Storage Errors

#### Error: "NoSuchBucket"

```
The specified bucket does not exist
```

**Solution:**
```bash
# 1. Check bucket name in .env
grep S3_BUCKET apps/api/.env

# 2. Verify bucket exists (AWS Console or CLI)
aws s3 ls

# 3. If missing, create it
aws s3 mb s3://buildingos-prod --region us-east-1

# 4. Restart application
npm run dev
```

#### Error: "AccessDenied"

```
Access Denied when uploading to S3
```

**Solution:**
```bash
# 1. Verify S3 credentials
echo $S3_ACCESS_KEY
echo $S3_SECRET_KEY

# 2. Check IAM permissions (must have s3:PutObject)
# In AWS Console:
# - IAM > Users > [user] > Permissions
# - Verify s3:PutObject, s3:GetObject allowed

# 3. Verify bucket policy allows the principal
# AWS Console > S3 > [bucket] > Permissions > Bucket Policy

# 4. Test with AWS CLI
aws s3 cp test.txt s3://buildingos-prod/ \
  --region us-east-1 \
  --profile [profile]
```

### Application Won't Start

#### Error: "Cannot find module 'config'"

**Solution:**
```bash
# Rebuild node_modules
rm -rf node_modules
npm install --workspaces

# Rebuild application
npm run build

# Restart
npm run dev
```

#### Error: "Port 4000 already in use"

**Solution:**
```bash
# Find process using port
lsof -i :4000

# Kill process
kill -9 [PID]

# Or change port in .env
PORT=4001

# Restart
npm run dev
```

### Performance Issues

#### Slow database queries

```bash
# 1. Enable Prisma debug
DEBUG=* npm run dev

# 2. Check slow query log
# PostgreSQL:
psql -c "SELECT query, calls, mean_time FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"

# 3. Add indexes if needed
# Edit schema.prisma and apply migration
```

#### High memory usage

```bash
# Check Node.js memory
node --max-old-space-size=4096 dist/main

# Or add to ecosystem.config.js
max_memory_restart: '1G'
```

---

## Additional Resources

- **Prisma Documentation**: https://www.prisma.io/docs/
- **NestJS Documentation**: https://docs.nestjs.com/
- **PostgreSQL Backup/Restore**: https://www.postgresql.org/docs/current/backup.html
- **Docker Deployment**: https://docs.docker.com/
- **Kubernetes Deployment**: https://kubernetes.io/docs/

---

**Last Updated**: February 18, 2026
**Version**: 1.0.0
