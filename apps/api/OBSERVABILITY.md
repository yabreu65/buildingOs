# BuildingOS API Observability Guide

**Date**: 2026-02-22
**Status**: ✅ PRODUCTION READY

---

## Overview

The BuildingOS API implements comprehensive observability for production deployments:

1. **Request Tracing**: Every request gets a unique `requestId` for end-to-end correlation
2. **Structured Logging**: JSON logs with Pino, including requestId, tenantId, userId
3. **Error Tracking**: Sentry integration with automatic context capture
4. **Health Checks**: Kubernetes-compatible liveness & readiness probes
5. **Contextual Diagnostics**: Errors can be diagnosed by requestId and tenantId

---

## 1. Request ID Tracking

### How It Works

Every HTTP request receives a unique `X-Request-Id` header:

1. **Middleware Generates ID**: `RequestIdMiddleware` creates UUID v4 for each request
2. **Header Injection**: `X-Request-Id` header added to response
3. **Context Attached**: Request ID attached to `req.id`, available throughout request lifecycle
4. **Logging Integration**: All logs include requestId for correlation

### Using Request IDs

**In Logs**:
```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "tenantId": "tenant-123",
  "userId": "user-456",
  "method": "POST",
  "route": "/buildings",
  "statusCode": 201,
  "durationMs": 145,
  "timestamp": "2026-02-22T10:30:00.000Z"
}
```

**In API Responses**:
```bash
curl -i http://localhost:4000/buildings
# Response headers include:
# X-Request-Id: 550e8400-e29b-41d4-a716-446655440000
```

**Correlation Example**:
```bash
# Request 1: Create building
curl -X POST http://localhost:4000/buildings \
  -H "X-Tenant-Id: tenant-123" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Building A"}'
# Returns: X-Request-Id: abc-123

# Logs for this request will all have requestId=abc-123
# Error? Search logs for abc-123 to see full request flow
```

---

## 2. Structured Logging with Pino

### Log Format

**Development**:
```
[YYYY-MM-DD HH:mm:ss.sss] INFO: POST /buildings - 201 (145ms)
```

**Production** (JSON format):
```json
{
  "level": 30,
  "time": "2026-02-22T10:30:00.000Z",
  "type": "http_request",
  "method": "POST",
  "route": "/buildings",
  "statusCode": 201,
  "durationMs": 145,
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "tenantId": "tenant-123",
  "userId": "user-456",
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "pid": 1234,
  "hostname": "api-pod-01"
}
```

### Available Log Levels

| Level | When | Example |
|-------|------|---------|
| DEBUG | Development only | Request details, internal operations |
| INFO | All requests | HTTP requests, normal operations |
| WARN | Warnings | Rate limit hit, configuration issue |
| ERROR | 5xx responses | Exceptions, database errors |

### Accessing Logs

**Local Development**:
```bash
npm run dev
# Logs printed to console with colors
```

**Production (JSON)**:
```bash
# Query logs via CloudWatch, Datadog, ELK, etc.
# Search by requestId:
# requestId: "550e8400-e29b-41d4-a716-446655440000"

# Search by tenant:
# tenantId: "tenant-123"

# Search by user:
# userId: "user-456"
```

### Automatic Redaction

Sensitive fields are automatically redacted:

**Redacted Fields**:
- password, passwordHash, password_confirmation
- authorization, cookie, x-api-key, x-auth-token
- jwt, token, secret, aws_secret_access_key
- sendgrid_api_key, smtp_pass, minio_secret_key

**Example**:
```json
{
  "password": "[REDACTED]",
  "token": "[REDACTED]",
  "smtp_pass": "[REDACTED]"
}
```

---

## 3. Error Tracking with Sentry

### Integration

Sentry is optional but recommended for production:

**Configuration**:
```bash
# In .env.production
SENTRY_DSN=https://key@sentry.io/project-id
SENTRY_ENVIRONMENT=production
```

**If not configured**: Error tracking disabled, system continues working normally

### Automatic Context Capture

Every error automatically includes:
- `requestId`: Unique request identifier
- `tenantId`: Which tenant was affected
- `userId`: Which user triggered the error
- `route`: API endpoint that failed
- `statusCode`: HTTP response code
- `method`: HTTP method (GET, POST, etc.)

### Example Error in Sentry

```json
{
  "contexts": {
    "request": {
      "requestId": "550e8400-e29b-41d4-a716-446655440000",
      "tenantId": "tenant-123",
      "userId": "user-456",
      "route": "/buildings",
      "statusCode": 500
    }
  },
  "tags": {
    "tenantId": "tenant-123",
    "userId": "user-456",
    "route": "/buildings",
    "statusCode": "500"
  },
  "user": {
    "id": "user-456",
    "email": "user@example.com",
    "username": "john_doe"
  },
  "message": "Database connection timeout",
  "timestamp": "2026-02-22T10:30:00.000Z"
}
```

### Setting User Context

User context is automatically set on login/signup:

```typescript
// auth.controller.ts
@Post('login')
async login(@Body() loginDto: LoginDto) {
  const response = await this.authService.login(user);
  // Automatically calls: sentryService.setUser(userId, email, name)
  return response;
}
```

### Debugging with Sentry

**Filter errors by tenant**:
1. Go to Sentry Issues
2. Add filter: `tags:tenantId:tenant-123`

**Filter errors by user**:
1. Go to Sentry Issues
2. Add filter: `user.id:user-456`

**Find specific request**:
1. Go to Sentry Issues
2. Add filter: `contexts.request.requestId:abc-123`

---

## 4. Health Checks

### Endpoints

#### Liveness Probe: `/health`

**Purpose**: Basic health check - is the API running?
**Response**: Always returns 200 OK if API is running
**Used by**: Kubernetes, Docker, load balancers to restart dead pods

```bash
curl http://localhost:4000/health
# Response:
# {
#   "status": "ok",
#   "timestamp": "2026-02-22T10:30:00.000Z"
# }
```

#### Readiness Probe: `/ready`

**Purpose**: Is the API ready to accept traffic?
**Response**: 200 OK if all dependencies healthy, 503 if not
**Used by**: Kubernetes, load balancers to route traffic only to ready pods

```bash
curl http://localhost:4000/ready
# Response (healthy):
# {
#   "status": "healthy",
#   "timestamp": "2026-02-22T10:30:00.000Z",
#   "checks": {
#     "database": { "status": "up", "latency": 2 },
#     "storage": { "status": "up", "latency": 5 },
#     "email": { "status": "up", "provider": "smtp" }
#   }
# }

# Response (unhealthy):
# HTTP 503 Service Unavailable
# {
#   "status": "unhealthy",
#   "timestamp": "2026-02-22T10:30:00.000Z",
#   "checks": {
#     "database": { "status": "down", "error": "Connection timeout" },
#     "storage": { "status": "up" },
#     "email": { "status": "up" }
#   }
# }
```

### Kubernetes Configuration

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: buildingos-api
spec:
  containers:
    - name: api
      image: buildingos-api:latest
      ports:
        - containerPort: 4000

      # Liveness probe: restart if dead
      livenessProbe:
        httpGet:
          path: /health
          port: 4000
        initialDelaySeconds: 10
        periodSeconds: 10
        timeoutSeconds: 5
        failureThreshold: 3

      # Readiness probe: route traffic only if ready
      readinessProbe:
        httpGet:
          path: /ready
          port: 4000
        initialDelaySeconds: 5
        periodSeconds: 5
        timeoutSeconds: 3
        failureThreshold: 2
```

---

## 5. Diagnostics Workflow

### Example: User Reports Error

**User says**: "I got an error creating a building at 10:30 AM"

**Step 1: Find Request ID**
```bash
# User's browser console:
# X-Request-Id: 550e8400-e29b-41d4-a716-446655440000
```

**Step 2: Search Logs by Request ID**
```bash
# CloudWatch/Datadog/ELK:
search requestId=550e8400-e29b-41d4-a716-446655440000

# Results:
# POST /buildings [201] (145ms) <- Success!
# Wait, but user says it failed...
```

**Step 3: Check for Errors in Sentry**
```bash
# Sentry filter:
contexts.request.requestId:550e8400-e29b-41d4-a716-446655440000

# Shows: Database query timeout after 144ms
# Then API returned 201 (race condition!)
```

**Step 4: Check Tenant and User Context**
```bash
# Full error details:
tenantId: "tenant-123"
userId: "user-456"
error: "Database connection pool exhausted"
timestamp: "2026-02-22T10:30:00.000Z"
```

**Step 5: Query Broader Context**
```bash
# Check if other tenants affected:
search error="Database connection pool exhausted"

# Results show only tenant-123 affected
# Check database metrics at 10:30 AM
# Find: Long-running query holding connections

# Resolution: Kill blocking query, rebuild connection pool
```

---

## 6. Production Deployment

### Required Environment Variables

```bash
# Logging
LOG_LEVEL=info  # debug, info, warn, error

# Error Tracking (optional but recommended)
SENTRY_DSN=https://key@sentry.io/project-id
SENTRY_ENVIRONMENT=production
```

### Monitoring Dashboard

Monitor these metrics:

1. **Request Latency**: P50, P95, P99 response times
2. **Error Rate**: 5xx errors as % of total requests
3. **Health Probe Success**: % of successful /ready checks
4. **Dependency Health**: Database, storage, email provider latency

### Alert Rules

Create alerts for:

| Metric | Threshold | Action |
|--------|-----------|--------|
| Error Rate | > 1% | Page on-call |
| Readiness Failures | > 2 consecutive | Check dependencies |
| P99 Latency | > 2000ms | Investigate query performance |
| Database Latency | > 100ms | Check connection pool |

---

## 7. Log Aggregation Setup

### CloudWatch (AWS)

```javascript
// logs appear automatically in CloudWatch Logs
// Group name: /aws/ecs/buildingos-api
// Stream name: api-pod-01

// CloudWatch Insights query:
fields @timestamp, requestId, tenantId, userId, statusCode, durationMs
| filter statusCode >= 500
| stats avg(durationMs), count() by tenantId
```

### Datadog

```bash
# Agent configuration: datadog.yaml
logs:
  - type: file
    path: /var/log/buildingos-api.log
    service: buildingos-api
    source: nodejs
    tags:
      - env:production
```

### ELK Stack (Elasticsearch + Logstash + Kibana)

```json
{
  "elasticsearch": {
    "hosts": ["elasticsearch:9200"],
    "index": "buildingos-api-%{+YYYY.MM.dd}"
  },
  "kibana": {
    "dashboard": "BuildingOS API Observability",
    "panels": [
      {"title": "Requests by Status", "metric": "statusCode"},
      {"title": "Latency", "metric": "durationMs"},
      {"title": "Errors by Tenant", "metric": "tenantId"}
    ]
  }
}
```

---

## 8. Troubleshooting

### Issue: Can't find a specific error

**Solution**:
1. Get request ID from user
2. Search logs: `requestId=xxx`
3. Check Sentry: `contexts.request.requestId:xxx`
4. Check API response headers: `X-Request-Id` header

### Issue: Tenant experiencing errors

**Solution**:
1. Search logs: `tenantId=tenant-123 statusCode>=500`
2. Check Sentry: `tags:tenantId:tenant-123`
3. Look for patterns (specific endpoint, time, user)

### Issue: Readiness probe failing

**Solution**:
```bash
# Check health status
curl http://localhost:4000/ready

# Specific failure:
{
  "status": "unhealthy",
  "checks": {
    "database": {"status": "down", "error": "Connection refused"}
  }
}

# Actions:
# 1. Check database connectivity
# 2. Check database credentials in environment
# 3. Restart pod to reconnect
```

---

## 9. Best Practices

1. **Always Include Request ID**: When reporting bugs, include `X-Request-Id` header value
2. **Filter by Tenant**: When investigating, filter by `tenantId` first
3. **Use Sentry for 5xx Errors**: Only 5xx errors auto-sent to Sentry
4. **Check Health Probes**: Before debugging, verify `/ready` returns 200
5. **Correlate with Metrics**: Match log timestamps with resource usage spikes

---

## 10. Support

**Questions?**
- See [SECURITY.md](./SECURITY.md) for security-related observability
- See [ARCHITECTURE.md](../../../ARCHITECTURE.md) for system design
- Contact: DevOps team

**Bug Reports**: Include:
- `X-Request-Id` from error response
- Timestamp of error
- Tenant ID if known
- User email if known
- Exact error message

---

**Last Updated**: 2026-02-22
**Maintained By**: BuildingOS Platform Team
**Status**: PRODUCTION READY ✅
