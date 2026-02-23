# BuildingOS API Security Configuration

This document outlines the security configurations, rate limiting rules, and environment-specific settings for the BuildingOS API.

## Overview

The BuildingOS API implements a multi-layered security approach:
1. **CORS** - Origin validation with X-Tenant-Id header
2. **Rate Limiting** - Endpoint-specific and global fallback limits
3. **Security Headers** - Helmet.js with environment-specific policies
4. **Audit Logging** - Comprehensive audit trail for security events
5. **Trust Proxy** - Support for load balancers and reverse proxies

---

## 1. CORS Configuration

### Allowed Origins

| Environment | Allowed Origins |
|-------------|-----------------|
| **Development** | `WEB_ORIGIN` + `localhost:3000`, `localhost:3001` |
| **Staging** | `WEB_ORIGIN` only |
| **Production** | `WEB_ORIGIN` only (must be HTTPS) |

### Configuration Details

```typescript
// apps/api/src/main.ts
app.enableCors({
  origin: (origin, callback) => {
    if (!origin || corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`[CORS] Blocked request from origin: ${origin}`);
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
});
```

### Required Environment Variables

- `WEB_ORIGIN`: Frontend URL (e.g., `https://app.buildingos.com`)
  - Must be HTTPS in production/staging
  - Should not include trailing slash

---

## 2. Rate Limiting Strategy

### Overview

Rate limiting protects against:
- **Brute force attacks** (login, signup)
- **Enumeration attacks** (invitations)
- **API abuse** (general endpoints)

### Endpoint-Specific Limits

#### Authentication Endpoints

| Endpoint | Limit | Window | Rationale |
|----------|-------|--------|-----------|
| `POST /auth/login` | 5 attempts | 15 minutes | Brute force protection |
| `POST /auth/signup` | 3 attempts | 1 hour | Account creation spam |
| `POST /auth/logout` | No limit | - | Safe operation |
| `GET /auth/me` | No limit | - | Safe operation |

#### Invitation Endpoints

| Endpoint | Limit | Window | Rationale |
|----------|-------|--------|-----------|
| `POST /invitations` (create) | 5 attempts | 1 hour | Spam prevention |
| `POST /invitations/validate` | 10 attempts | 15 minutes | Token validation |
| `POST /invitations/accept` | 10 attempts | 15 minutes | Accept flow |

#### Super-Admin Endpoints

| Endpoint | Limit | Window | Rationale |
|----------|-------|--------|-----------|
| `POST /super-admin/impersonation/start` | 10 attempts | 1 hour | Sensitive operation |
| `POST /super-admin/*` (all writes) | 30 requests | 1 minute | Operational safety |
| `GET /super-admin/*` (all reads) | No limit | - | Safe operations |

#### Global Fallback

| Type | Limit | Window |
|------|-------|--------|
| All other endpoints | 300 requests | 1 minute | Generous default for API clients |

### Rate Limit Headers

All requests receive rate limit metadata in response headers:

```
RateLimit-Limit: 300
RateLimit-Remaining: 295
RateLimit-Reset: 1645123456
```

### Rate Limit Response

When limit exceeded (HTTP 429):

```json
{
  "statusCode": 429,
  "message": "Too many requests, please try again later",
  "code": "RATE_LIMITED",
  "retryAfter": 45
}
```

### Trust Proxy Configuration

In production/staging, the API trusts the `X-Forwarded-For` header from the load balancer to identify real client IPs:

```typescript
// apps/api/src/main.ts
if (config.nodeEnv !== 'development') {
  expressApp.set('trust proxy', 1);
}
```

This ensures rate limiting works correctly behind nginx, AWS ELB, etc.

**Important**: Only set `trust proxy` in production. In development, use the raw request IP.

### In-Memory Implementation

The current MVP uses in-memory rate limiting. For multi-instance deployments, upgrade to Redis:

```bash
npm install rate-limit-redis
```

Then modify `rate-limit.middleware.ts` to use RedisStore instead of Map.

---

## 3. Security Headers (Helmet.js)

### Development Environment

```typescript
helmet({
  contentSecurityPolicy: false,        // Disabled for Swagger UI
  hsts: false,                          // Disabled for local testing
  xContentTypeOptions: true,
  xFrameOptions: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
})
```

### Staging & Production Environment

```typescript
helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'none'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,        // 1 year
    includeSubDomains: true,
  },
  // ... other headers same as dev
})
```

### Security Headers Explained

| Header | Purpose | Value |
|--------|---------|-------|
| `X-Content-Type-Options` | Prevent MIME sniffing | `nosniff` |
| `X-Frame-Options` | Prevent clickjacking | `DENY` |
| `Referrer-Policy` | Control referrer info | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | Force HTTPS (prod only) | `max-age=31536000; includeSubDomains` |
| `Content-Security-Policy` | XSS protection (prod only) | Restrictive policy, see above |
| `Cross-Origin-Opener-Policy` | Prevent data leakage | `same-origin` |
| `Cross-Origin-Resource-Policy` | Control resource access | `same-origin` |
| `Permissions-Policy` | Disable dangerous features | (via Helmet defaults) |

---

## 4. Audit Logging

### Covered Security Events

#### Authentication

- `AUTH_LOGIN` - Successful user login
- `AUTH_FAILED_LOGIN` - Failed login attempt
- `USER_CREATE` - New user account created (signup)

#### Units Management

- `UNIT_CREATE` - Unit created
- `UNIT_UPDATE` - Unit modified
- `UNIT_DELETE` - Unit deleted

#### Financial Operations

- `CHARGE_CREATE` - New charge created
- `CHARGE_CANCEL` - Charge cancelled

#### Occupant Management

- `OCCUPANT_ASSIGN` - Resident assigned to unit
- `OCCUPANT_REMOVE` - Resident removed from unit

#### Tickets & Communications

- `TICKET_CREATE` - Ticket created
- `TICKET_STATUS_CHANGE` - Status updated
- `TICKET_COMMENT_ADD` - Comment added

#### Building Management

- `BUILDING_CREATE` - Building created
- `BUILDING_UPDATE` - Building modified
- `BUILDING_DELETE` - Building deleted

### Accessing Audit Logs

**Endpoint**: `GET /audit/logs`

**Query Parameters**:

| Parameter | Type | Example | Description |
|-----------|------|---------|-------------|
| `action` | string | `AUTH_LOGIN` | Filter by action type |
| `entityType` | string | `User` | Filter by entity type |
| `entityId` | string | `uuid` | Filter by specific entity |
| `startDate` | ISO8601 | `2026-02-22T00:00:00Z` | Start timestamp |
| `endDate` | ISO8601 | `2026-02-23T00:00:00Z` | End timestamp |
| `skip` | number | `0` | Pagination offset |
| `take` | number | `50` | Results per page (max 100) |

**Access Control**:

| Role | Permissions |
|------|-------------|
| `SUPER_ADMIN` | View all audit logs across all tenants |
| `TENANT_ADMIN` | View only own tenant's audit logs |
| `OPERATOR` | View only own tenant's audit logs |
| `RESIDENT` | Forbidden (403) |

**Example Request**:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/audit/logs?action=AUTH_LOGIN&take=50"
```

**Example Response**:

```json
{
  "logs": [
    {
      "id": "uuid",
      "tenantId": "tenant-uuid",
      "action": "AUTH_LOGIN",
      "entityType": "User",
      "entityId": "user-uuid",
      "actorUserId": "user-uuid",
      "metadata": {
        "email": "user@example.com",
        "isSuperAdmin": false
      },
      "createdAt": "2026-02-22T12:30:45.123Z"
    }
  ],
  "total": 1,
  "skip": 0,
  "take": 50
}
```

---

## 5. JWT Configuration

### Token Structure

```json
{
  "email": "user@example.com",
  "sub": "user-id",
  "isSuperAdmin": false,
  "iat": 1645123456,
  "exp": 1645210456
}
```

### Required Environment Variables

- `JWT_SECRET`: Secret key for signing tokens
  - **Minimum length**: 64 characters (recommended)
  - **Must be random**: Use `openssl rand -base64 48` to generate
  - **Should be rotated periodically** in production

- `JWT_EXPIRATION`: Token TTL in seconds (default: `86400` = 24 hours)

### JWT Best Practices

1. **Use HTTPS Only**: Always transmit tokens over HTTPS
2. **Secure Storage**: Store in `sessionStorage` (not `localStorage`)
3. **Automatic Refresh**: Implement token refresh before expiration
4. **Revocation**: On logout, tokens remain valid until expiration (HTTP-only cookies recommended)

**Note**: Refresh tokens are planned for Phase N and require architectural changes.

---

## 6. Environment Variables for Production

### Required Configuration

```bash
# Security
JWT_SECRET=<64+ random characters>        # Required
JWT_EXPIRATION=86400                      # Optional, default 24h
NODE_ENV=production

# CORS
WEB_ORIGIN=https://app.buildingos.com    # Must be HTTPS

# Database
DATABASE_URL=postgresql://...             # Production database

# Email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@buildingos.com
SMTP_PASSWORD=<secure password>

# Optional: Observability
SENTRY_DSN=https://...@sentry.io/...
SENTRY_ENVIRONMENT=production

# Optional: MinIO/S3
MINIO_ENDPOINT=minio.example.com
MINIO_ACCESS_KEY=<secure key>
MINIO_SECRET_KEY=<secure key>
MINIO_BUCKET=documents
```

---

## 7. Production Deployment Checklist

### Before Going Live

- [ ] Set `NODE_ENV=production`
- [ ] Generate random `JWT_SECRET` (64+ chars): `openssl rand -base64 48`
- [ ] Configure `WEB_ORIGIN` to HTTPS only
- [ ] Set all SMTP credentials for email notifications
- [ ] (Optional) Configure Sentry for error tracking
- [ ] Enable HTTPS/TLS on load balancer
- [ ] Verify `trust proxy` is set for your load balancer
- [ ] Test rate limiting with load testing tool
- [ ] Verify audit logs are being generated
- [ ] Set up log aggregation (CloudWatch, Datadog, etc.)
- [ ] Configure database backups
- [ ] Test disaster recovery procedures

### Monitoring

Monitor these metrics post-deployment:

1. **Rate Limit Hits**: High 429 responses may indicate legitimate traffic or attacks
2. **Auth Failures**: Spike in `AUTH_FAILED_LOGIN` suggests brute force attempts
3. **API Latency**: Ensure rate limiting doesn't impact performance
4. **Audit Log Volume**: Should grow steadily with user activity

---

## 8. Updating JWT_SECRET in Production

If you need to rotate JWT_SECRET:

1. Deploy with both old and new secrets (implement dual-verification)
2. Wait for all old tokens to expire
3. Remove old secret from code
4. Redeploy

**Current limitation**: The system uses a single secret. To support rotation:

```typescript
// Implement in jwt.strategy.ts
const validSecrets = [process.env.JWT_SECRET, process.env.JWT_SECRET_OLD];
for (const secret of validSecrets) {
  try {
    return jwtService.verify(token, secret);
  } catch (e) {
    continue;
  }
}
throw new UnauthorizedException('Invalid token');
```

---

## 9. Attack Scenarios & Mitigations

### Scenario 1: Brute Force Login Attack

**Attack**: Attacker tries 100 passwords per second

**Mitigation**:
- Rate limit: 5 attempts per 15 minutes per IP
- Audit log: `AUTH_FAILED_LOGIN` tracked
- Response: 429 Too Many Requests after 5 failures

### Scenario 2: Account Enumeration via Invitations

**Attack**: Attacker lists valid email addresses

**Mitigation**:
- Rate limit: 10 validation attempts per 15 minutes
- No different error messages for "invalid token" vs "invalid email"
- 404 for both cases (same response)

### Scenario 3: Cross-Tenant Data Access

**Attack**: User A tries to access User B's data

**Mitigation**:
- JWT contains tenant context
- All database queries filtered by `tenantId` from token
- API returns 404 for cross-tenant requests (same as "not found")
- Audit log: Attempt recorded

### Scenario 4: XSS in Documentation

**Attack**: Attacker injects script in Swagger UI

**Mitigation**:
- CSP enabled in production disallows inline scripts
- Swagger UI disabled in production (dev-only)
- Input validation on all endpoints

---

## 10. Security Testing

### Manual Testing

#### Rate Limiting

```bash
#!/bin/bash
# Test login rate limit (5 per 15 min)

for i in {1..7}; do
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    http://localhost:4000/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}')
  echo "Request $i: HTTP $http_code"
  sleep 1
done

# Expected: 1-5 = 401, 6-7 = 429
```

#### Security Headers

```bash
# Check for expected headers
curl -I http://localhost:4000/health | grep -E "X-Frame|X-Content|Referrer"

# In production, also check:
# - Strict-Transport-Security
# - Content-Security-Policy (if non-dev)
```

#### Audit Logging

```bash
# Login and check audit
TOKEN=$(curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password"}' | jq -r '.accessToken')

# Check audit log
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/audit/logs?action=AUTH_LOGIN | jq '.'
```

---

## 11. Support & Escalation

### Security Issues

If you discover a security vulnerability:

1. **Do NOT** create a public GitHub issue
2. Email: `security@buildingos.com`
3. Include: Steps to reproduce, impact assessment, proposed fix
4. We will respond within 24 hours

### Questions?

- **General Security**: See [ARCHITECTURE.md](../../../ARCHITECTURE.md)
- **Audit Logging**: See [AUDIT_EVENTS.md](./AUDIT_EVENTS.md)
- **Infrastructure**: Contact DevOps team

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-22 | Initial security documentation |

---

**Last Updated**: 2026-02-22
**Maintained By**: BuildingOS Security Team
