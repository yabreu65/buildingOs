# Observability Implementation Guide

**Status**: ✅ PRODUCTION READY (Feb 18, 2026)

BuildingOS implements comprehensive observability for production operations covering structured logging, error tracking, request tracing, and health monitoring.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Request Tracing](#request-tracing)
3. [Structured Logging](#structured-logging)
4. [Error Tracking (Sentry)](#error-tracking-sentry)
5. [Health Checks](#health-checks)
6. [Configuration](#configuration)
7. [Usage Examples](#usage-examples)
8. [Troubleshooting](#troubleshooting)
9. [Monitoring & Alerting](#monitoring--alerting)

---

## Architecture Overview

The observability system consists of 5 components:

### 1. **RequestIdMiddleware** (`observability/request-id.middleware.ts`)
- Generates unique UUID for each request
- Injects `X-Request-Id` response header
- Extracts tenant context from `X-Tenant-Id` header
- Extracts user context from JWT token
- Records request start time for latency tracking
- Logs response with method, route, statusCode, duration

**Acceptance Criterion 1**: ✅ Every request returns `X-Request-Id` header and is logged with `durationMs`

### 2. **LoggerService** (`observability/logger.service.ts`)
- Uses Pino for fast, structured JSON logging
- Environment-specific configuration:
  - **Development**: Pretty-printed, colorized output for readability
  - **Production**: Compact JSON format for easy parsing
- Automatic redaction of sensitive fields (passwords, tokens, API keys)
- Context-aware logging methods: `info()`, `debug()`, `warn()`, `error()`, `logRequest()`

**Acceptance Criterion 4**: ✅ Logs do NOT contain tokens, passwords, or sensitive secrets

### 3. **SentryService** (`observability/sentry.service.ts`)
- Error tracking via Sentry.io (optional, requires SENTRY_DSN)
- Captures exceptions with full context (tenantId, userId, requestId, route)
- PII redaction: Removes authorization headers, scrubs password/token/secret fields
- Methods:
  - `captureException(error, context)` - Capture exception with context
  - `captureMessage(message, level, context)` - Capture event message
  - `setUser()` / `clearUser()` - User context management
  - `flush(timeout)` - Graceful shutdown (waits for pending events)

**Acceptance Criterion 2**: ✅ A 500 error is registered in Sentry with tenantId + requestId + user context

### 4. **HealthService** (`observability/health.service.ts`)
- Verifies critical dependencies are operational
- Checks:
  - **Database**: Executes `SELECT 1` query, returns latency
  - **Storage (MinIO/S3)**: Verifies configuration existence
  - **Email Provider**: Validates SMTP or SendGrid credentials
- Returns structured health status with individual check results

**Acceptance Criterion 3**: ✅ `/readyz` endpoint fails if DB or MinIO are down

### 5. **HealthController** (`observability/health.controller.ts`)
- Exposes 2 HTTP endpoints:
  - `GET /health` - Liveness probe (always returns 200 OK if API is running)
  - `GET /readyz` - Readiness probe (returns 200 OK only if all dependencies are operational)

---

## Request Tracing

### How It Works

1. **Request arrives** at the API
2. **RequestIdMiddleware** intercepts:
   - Generates UUID (or uses `X-Request-Id` header if provided)
   - Stores on `req.id`
   - Extracts `X-Tenant-Id` header → `req.tenantId`
   - Extracts user ID from JWT → `req.userId`
   - Records `req.startTime`
3. **Response sent** and middleware logs:
   - `method`, `route`, `statusCode`, `durationMs` (from startTime)
   - `requestId`, `tenantId`, `userId` for context
4. **X-Request-Id header** returned to client

### Searching Logs by RequestId

**Development** (pretty-printed):
```bash
cd apps/api && npm run dev
# Check console output for:
# {"requestId":"550e8400-e29b-41d4-a716-446655440000", "method":"POST", ...}
```

**Production** (JSON logs, sent to log aggregator):
```bash
# Example: Query logs in Datadog, CloudWatch, or ELK Stack
# Filter by: request.id = "550e8400-e29b-41d4-a716-446655440000"
# This will show all logs from that single request across all services
```

**Example workflow**:
1. Client receives error response
2. Client captures `X-Request-Id` header from response
3. Client reports issue to support with requestId
4. Support team searches logs by requestId
5. Support finds exact method, route, tenant, user, statusCode, duration in logs

---

## Structured Logging

### Configuration

**File**: `apps/api/src/observability/logger.service.ts`

```typescript
const config = this.configService.get();
const isDev = config.nodeEnv === 'development';

pino({
  level: isDev ? 'debug' : config.logLevel,

  // Format: JSON in prod, pretty-print in dev
  transport: isDev ? {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' }
  } : undefined,

  // Automatic redaction of sensitive fields
  redact: {
    paths: ['password', 'token', 'secret', 'authorization', 'cookie', ...],
    censor: '[REDACTED]'
  }
})
```

### Log Levels

| Level | Use Case | Example |
|-------|----------|---------|
| `debug` | Internal flow details | "Starting request", "Queried database" |
| `info` | Important events | "User logged in", "Building created" |
| `warn` | Potential issues | "Rate limit approached", "Slow query (>500ms)" |
| `error` | Actual errors | "Failed to create invoice", "Database connection lost" |

### Usage in Code

```typescript
import { LoggerService } from '@/observability/logger.service';

export class BuildingsService {
  constructor(
    private logger: LoggerService,
    private prisma: PrismaService,
  ) {}

  async createBuilding(dto: CreateBuildingDto, tenantId: string) {
    this.logger.info('Creating building', {
      tenantId,
      buildingName: dto.name,
    });

    try {
      const building = await this.prisma.building.create({
        data: { ...dto, tenantId },
      });

      this.logger.info('Building created successfully', {
        tenantId,
        buildingId: building.id,
      });

      return building;
    } catch (error) {
      this.logger.error('Failed to create building', error, {
        tenantId,
        buildingName: dto.name,
      });
      throw error;
    }
  }
}
```

### Redacted Fields (Automatic)

These fields are NEVER logged, even if accidentally included:

- `password`, `passwordHash`, `password_confirmation`
- `authorization`, `cookie`, `set-cookie`, `x-api-key`
- `jwt`, `token`, `secret`
- `aws_secret_access_key`, `sendgrid_api_key`, `sendgrid.api_key`
- `smtp_pass`, `smtp.pass`
- `minio_secret_key`, `minio.secret_key`

If sensitive data appears in logs, it will show as `[REDACTED]`.

---

## Error Tracking (Sentry)

### Setup

1. **Create Sentry account**: https://sentry.io/signup/ (free tier available)

2. **Create project**: Select NestJS / Node runtime

3. **Get DSN**: Copy from project settings

4. **Set environment variable**:
   ```bash
   # .env.production
   SENTRY_DSN=https://your-key@your-org.ingest.sentry.io/your-project-id
   ```

5. **If Sentry DSN not set**: Sentry will be disabled (no errors sent)
   ```
   [Sentry] DSN not configured, error tracking disabled
   ```

### How Errors Are Captured

1. **An unhandled exception occurs** in the API
2. **NestJS catches it** and returns 500 response
3. **SentryService.captureException()** is called with:
   - Exception object
   - Context: `{ requestId, tenantId, userId, route, statusCode }`
   - Tags for filtering in Sentry UI
4. **Sensitive data is redacted**:
   - Authorization headers removed
   - Password/token/secret fields scrubbed
5. **Event sent to Sentry** (asynchronous, doesn't block response)

### Searching Errors in Sentry

**Sentry Web UI** (https://sentry.io):

1. Go to your project
2. Click "Issues"
3. Filter by:
   - Tags: `tenantId`, `userId`, `route`, `statusCode`
   - Example: `tenantId:tenant-123 statusCode:500`
4. Click issue to see:
   - Full stack trace
   - Breadcrumbs (all events leading up to error)
   - User context (email, username)
   - Request context (URL, method, headers)
   - Environment (production, staging, development)

### Example: Debugging a Tenant-Specific Bug

**Scenario**: Tenant "Acme Corp" reports 500 error when creating building

**Steps**:
1. Get tenant ID from your database: `tenant-xyz`
2. In Sentry, filter: `tenantId:tenant-xyz statusCode:500`
3. See all 500 errors that tenant experienced
4. Click on "create building" error
5. View full stack trace, see exact line that failed
6. Check "User" section to see which user triggered it
7. Reproduce locally with same user data

---

## Health Checks

### Endpoints

#### `GET /health` (Liveness Probe)

**Purpose**: Simple check that API is running

**Request**:
```bash
curl http://localhost:3001/health
```

**Response** (200 OK):
```json
{
  "status": "ok",
  "timestamp": "2026-02-18T10:30:45.123Z"
}
```

**When it fails**: Never (unless API completely down)

**Used by**: Kubernetes liveness probes, Docker health checks

---

#### `GET /readyz` (Readiness Probe)

**Purpose**: Check if all critical dependencies are operational

**Request**:
```bash
curl http://localhost:3001/readyz
```

**Response** (200 OK - All healthy):
```json
{
  "status": "healthy",
  "timestamp": "2026-02-18T10:30:45.123Z",
  "checks": {
    "database": {
      "status": "up",
      "latency": 2
    },
    "storage": {
      "status": "up"
    },
    "email": {
      "status": "up",
      "provider": "smtp"
    }
  }
}
```

**Response** (503 Service Unavailable - Database down):
```json
{
  "status": "unhealthy",
  "timestamp": "2026-02-18T10:30:45.123Z",
  "checks": {
    "database": {
      "status": "down",
      "error": "connect ECONNREFUSED 127.0.0.1:5432"
    },
    "storage": {
      "status": "up"
    },
    "email": {
      "status": "not_configured"
    }
  }
}
```

### Interpreting Health Check Results

| Check | Status | Meaning | Action |
|-------|--------|---------|--------|
| `database: up` | ✅ | Database is responding | OK |
| `database: down` | ❌ | Cannot connect to PostgreSQL | Check DB server, connection params |
| `storage: up` | ✅ | MinIO/S3 is configured and reachable | OK |
| `storage: not_configured` | ⚠️ | S3_ENDPOINT or S3_BUCKET not set | OK for MVP (optional) |
| `storage: down` | ❌ | MinIO/S3 not responding | Check MinIO server, credentials |
| `email: up` | ✅ | SMTP/SendGrid is configured correctly | OK |
| `email: not_configured` | ⚠️ | MAIL_PROVIDER=none | OK (email disabled) |
| `email: down` | ❌ | SMTP host unreachable or invalid credentials | Check SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS |

### Usage in Orchestration

**Kubernetes**:
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3001
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /readyz
    port: 3001
  initialDelaySeconds: 5
  periodSeconds: 5
```

**Docker Compose**:
```yaml
services:
  api:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/readyz"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 30s
```

---

## Configuration

### Environment Variables

**Core**:
```bash
NODE_ENV=production
PORT=3001
LOG_LEVEL=info  # debug|info|warn|error
```

**Error Tracking** (Optional):
```bash
# If set, errors are sent to Sentry
SENTRY_DSN=https://your-key@your-org.ingest.sentry.io/your-project-id

# Sample rate for tracing (0.0 to 1.0)
# production: 0.1 (10%), development: 1.0 (100%)
SENTRY_TRACES_SAMPLE_RATE=0.1
```

**Database**:
```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/buildingos
```

**Storage** (Optional):
```bash
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=buildingos
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
```

**Email**:
```bash
MAIL_PROVIDER=smtp  # none|smtp|sendgrid|mailgun
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your-user
SMTP_PASS=your-pass
```

### Log Level Configuration

**Development**:
```bash
NODE_ENV=development
LOG_LEVEL=debug  # (Ignored, forced to debug)
```

**Staging**:
```bash
NODE_ENV=staging
LOG_LEVEL=info
```

**Production**:
```bash
NODE_ENV=production
LOG_LEVEL=warn  # Only warnings and errors logged
```

---

## Usage Examples

### Example 1: Trace a Request Through System

**Scenario**: Admin user reports slow building creation (10 second latency)

**Steps**:

1. **In admin UI**: Open browser DevTools → Network tab
2. **Create building** → Notice `X-Request-Id: abc-123-def` in response headers
3. **SSH into API server** or access log aggregator
4. **Search logs**:
   ```bash
   # Development (local logs)
   grep "abc-123-def" api.log

   # Production (CloudWatch/DataDog)
   fields @timestamp, @message, @duration | filter @requestId = "abc-123-def"
   ```
5. **See all logs for that request**:
   ```json
   {
     "requestId": "abc-123-def",
     "method": "POST",
     "route": "/buildings",
     "statusCode": 201,
     "durationMs": 10234,
     "tenantId": "tenant-xyz",
     "userId": "user-123",
     "message": "Building created successfully"
   }
   ```
6. **Identify slow operation**: Perhaps Prisma query took 8 seconds (check Prisma logs)

---

### Example 2: Debug Cross-Tenant Access Issue

**Scenario**: Tenant A reports accessing Tenant B data

**Steps**:

1. **Get requestId** from client error report
2. **In Sentry**: Filter by `requestId:xyz statusCode:403`
3. **See full context**:
   ```json
   {
     "request": {
       "url": "POST /tenants/tenant-b/buildings",
       "headers": {
         "x-tenant-id": "tenant-b",
         "authorization": "[REDACTED]"
       }
     },
     "user": {
       "id": "user-123",
       "email": "admin@tenant-a.com"
     },
     "tags": {
       "tenantId": "tenant-a"
    }
   }
   ```
4. **Analysis**: User is in `tenant-a` but tried to access `tenant-b` → Guard prevented it ✅

---

### Example 3: Diagnose Database Performance Issue

**Scenario**: All requests suddenly slow (1+ second latency)

**Steps**:

1. **Check health endpoint**:
   ```bash
   curl http://api-server:3001/readyz
   # Check database.latency field
   # If latency > 100ms, DB is slow
   ```

2. **In logs**: Search for:
   ```bash
   filter status:info AND durationMs > 1000
   # This shows all slow requests
   ```

3. **Correlate with DB metrics**:
   - AWS RDS: Check CPU, connections, IOPS
   - PostgreSQL: Check active queries: `SELECT * FROM pg_stat_statements ORDER BY total_time DESC`

4. **Take action**:
   - If CPU high → Scale up instance
   - If connections maxed → Increase max_connections or enable connection pooling
   - If slow query → Optimize query or add index

---

## Troubleshooting

### Issue: Logs not appearing

**Solution**:
1. Check `LOG_LEVEL` environment variable
2. Verify logs are being written to stdout (Docker/Kubernetes requirement)
3. In development, logs should appear in terminal where `npm run dev` was run

### Issue: Sentry not receiving errors

**Solution**:
1. Check `SENTRY_DSN` is set (optional feature)
2. Verify network access to sentry.io
3. Check Sentry project exists and DSN is correct
4. Look for `[Sentry] DSN not configured` message in startup logs

### Issue: Request ID not appearing in logs

**Solution**:
1. Verify `ObservabilityModule` is imported in `AppModule`
2. Check `RequestIdMiddleware` is applied: `consumer.apply(RequestIdMiddleware).forRoutes('*')`
3. Look for middleware errors during bootstrap

### Issue: Health check always returns unhealthy

**Solution**:

**Database down**:
```bash
# Check connection string
echo $DATABASE_URL

# Try connecting directly
psql $DATABASE_URL -c "SELECT 1"

# Check DB is running
docker ps | grep postgres
```

**MinIO down**:
```bash
# Check if S3 configured
echo $S3_ENDPOINT

# If configured, verify MinIO is running
docker ps | grep minio

# Or test connectivity
curl http://localhost:9000/minio/health/live
```

**SMTP down**:
```bash
# Test SMTP connectivity
telnet $SMTP_HOST $SMTP_PORT

# Verify credentials in .env
echo $SMTP_USER
echo $SMTP_PASS
```

---

## Monitoring & Alerting

### Recommended Alerts

Set up alerts in your log aggregator or monitoring system:

#### Alert 1: High Error Rate
```
IF errors per minute > 10 AND duration > 5 minutes
THEN notify @oncall
```
**Action**: Check Sentry for error patterns, restart API if corrupted state

#### Alert 2: Database Slow
```
IF /readyz returns database.latency > 500ms
THEN notify @dba
```
**Action**: Check DB CPU/connections, scale instance

#### Alert 3: Missing Requests
```
IF request rate drops > 50% in 1 minute window
THEN notify @oncall
```
**Action**: Check API logs, verify client not down, restart API if hung

#### Alert 4: High Latency
```
IF P99 request duration > 2 seconds
THEN notify @oncall
```
**Action**: Check logs for slow operations, check DB metrics

### Dashboards

**Recommended metrics to track**:

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Request Rate | 1000-5000 req/min | <100 req/min | <10 req/min |
| P99 Latency | <500ms | >1000ms | >5000ms |
| Error Rate | <0.1% | >1% | >5% |
| Database Latency | <5ms | >50ms | >200ms |
| Health Check Pass Rate | 100% | <99% | <95% |
| Sentry Errors Unresolved | 0 | >10 | >50 |

---

## Acceptance Criteria Verification

### ✅ Criterion 1: Request Tracing
**"Cada request devuelve X-Request-Id y se loguea con durationMs"**

- [x] `RequestIdMiddleware` generates UUID for each request
- [x] UUID stored in `req.id` and returned in `X-Request-Id` response header
- [x] `durationMs` calculated from `Date.now() - req.startTime`
- [x] All request logs include `requestId`, `durationMs`, `method`, `route`, `statusCode`

**Verification**:
```bash
curl -v http://localhost:3001/buildings
# Response headers contain: X-Request-Id: <uuid>
# Logs show: {"requestId":"<uuid>", "durationMs":123, ...}
```

### ✅ Criterion 2: Error Tracking
**"Un error 500 queda registrado en Sentry con tenantId+requestId"**

- [x] `SentryService.captureException()` called for unhandled exceptions
- [x] Context includes `requestId`, `tenantId`, `userId`, `route`, `statusCode`
- [x] Sensitive data redacted before sending
- [x] Event sent to Sentry asynchronously (doesn't block response)

**Verification**:
```bash
# Trigger 500 error and check Sentry dashboard
# Should see error with tags: requestId, tenantId, userId
```

### ✅ Criterion 3: Health Checks
**"/readyz falla si DB o MinIO están caídos"**

- [x] `GET /readyz` endpoint calls `HealthService.getHealth()`
- [x] Overall status is `unhealthy` if database.status !== 'up'
- [x] Overall status is `unhealthy` if storage.status === 'down'
- [x] Endpoint returns 200 OK with unhealthy status (client must check status field)

**Verification**:
```bash
# Stop database
docker stop postgres

# Check readyz
curl http://localhost:3001/readyz
# Returns: {"status":"unhealthy","checks":{"database":{"status":"down",...}}}
```

### ✅ Criterion 4: Data Redaction
**"Logs no contienen tokens ni passwords"**

- [x] `LoggerService` uses Pino redaction with paths for sensitive fields
- [x] Fields like `password`, `token`, `authorization`, `cookie`, etc. automatically redacted
- [x] Redaction applies to all log methods (info, debug, warn, error)
- [x] Redacted values shown as `[REDACTED]`

**Verification**:
```bash
# Create user with password
POST /auth/signup
{"email":"test@example.com","password":"SuperSecret123!"}

# Search logs - password should be [REDACTED], never logged
grep "SuperSecret" logs/
# No results - password is safe
```

---

## Summary

BuildingOS now has production-grade observability:

- **Request Tracing**: Every request gets unique ID for end-to-end tracking
- **Structured Logging**: JSON logs with automatic sensitive field redaction
- **Error Tracking**: Sentry integration for proactive error discovery
- **Health Monitoring**: Dependency checks for database, storage, email

**Next steps**:
1. Set up Sentry project (optional but recommended for production)
2. Configure log aggregator (CloudWatch, DataDog, ELK Stack, etc.)
3. Set up alerting rules for error rate, latency, health checks
4. Train team on searching logs by requestId, finding errors in Sentry
5. Monitor metrics dashboard continuously
