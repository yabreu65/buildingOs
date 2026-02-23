# Security Configuration - BuildingOS API

## Overview

BuildingOS API implements a comprehensive security strategy covering:
- **Headers & HTTPS**: Helmet security headers
- **Rate Limiting**: Protect against brute force and abuse
- **CORS**: Cross-origin request validation
- **JWT**: Secure token-based authentication
- **Audit Logging**: Track all sensitive operations
- **Environment-based Config**: Different policies per environment

---

## 1. Security Headers (Helmet)

### Configuration by Environment

| Header | Development | Staging | Production |
|--------|-------------|---------|------------|
| **CSP** | Disabled | Enabled | Enabled |
| **HSTS** | Disabled | Disabled | Enabled (1y) |
| **X-Frame-Options** | DENY | DENY | DENY |
| **X-Content-Type-Options** | nosniff | nosniff | nosniff |
| **Referrer-Policy** | strict-origin-when-cross-origin | strict-origin-when-cross-origin | strict-origin-when-cross-origin |

### Content Security Policy (CSP) - Prod Only

```
default-src: 'self'                    # Only same origin
script-src: 'self'                     # No inline scripts
style-src: 'self' 'unsafe-inline'      # Inline styles allowed (necessary)
img-src: 'self' data: https:           # Local, data URIs, HTTPS external
connect-src: 'self'                    # API calls to self only
font-src: 'self'                       # Local fonts only
object-src: 'none'                     # No plugins
media-src: 'none'                      # No media
frame-src: 'none'                      # No iframes (X-Frame-Options)
```

### HTTP Strict Transport Security (HSTS) - Prod Only

```
max-age: 31536000 (1 year)
includeSubDomains: true
```

Forces HTTPS for all subsequent requests from the client.

---

## 2. Rate Limiting

### Configuration by Endpoint

| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| **POST /auth/login** | 5 | 15 min | Brute force protection |
| **POST /auth/signup** | 3 | 1 hour | Account enumeration |
| **POST /leads/public** | 10 | 1 min | Lead form abuse |
| **POST /invitations** | 5 | 1 hour | Invitation spam |
| **All other writes** | 100 | 1 min | General API protection |
| **All GET requests** | ∞ | - | Read-only, safe from abuse |

---

## 3. CORS Configuration

### Origins Allowed

**Development**: localhost:3000, localhost:3001 + WEB_ORIGIN env
**Staging/Production**: WEB_ORIGIN env var only (HTTPS required)

### Allowed Methods & Headers

```
Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Headers: Content-Type, Authorization, X-Tenant-Id
Credentials: true
```

---

## 4. JWT & Authentication

### Token Structure

```typescript
{
  email: string,
  sub: string,           // User ID
  isSuperAdmin: boolean, // Global flag
  iat: number,
  exp: number            // 6-day expiry
}
```

### Environment Requirements

**Production Checklist**:
- [ ] JWT_SECRET: 64+ random characters (min requirement)
- [ ] WEB_ORIGIN: HTTPS URL only
- [ ] DATABASE_SSL: true
- [ ] NODE_ENV: production
- [ ] Sentry error tracking enabled

---

## 5. Audit Logging

### Covered Actions

- `AUTH_LOGIN` / `AUTH_FAILED_LOGIN` - Authentication events
- `USER_CREATE` - New user signup
- `BUILDING_CREATE` / `BUILDING_UPDATE` / `BUILDING_DELETE`
- `UNIT_CREATE` / `UNIT_UPDATE` / `UNIT_DELETE`
- `OCCUPANT_ASSIGN` / `OCCUPANT_REMOVE`
- `TICKET_CREATE` / `TICKET_STATUS_CHANGE` / `TICKET_COMMENT_ADD`
- `CHARGE_CREATE` / `CHARGE_CANCEL` - Finance operations
- `PLAN_CHANGED` - Subscription modifications
- `IMPERSONATION_STARTED` - Support mode

### Fire-and-Forget Pattern

All audit logging is non-blocking:

```typescript
void this.auditService.createLog({
  action: AuditAction.USER_CREATE,
  ...metadata
}).catch(error => logger.error(`Audit failed: ${error}`));
```

---

## 6. Security Best Practices

### Before Production

- [ ] Set JWT_SECRET to 64+ random characters
- [ ] Ensure WEB_ORIGIN is HTTPS
- [ ] Enable DATABASE_SSL=true
- [ ] Configure production email provider
- [ ] Review rate limits under load
- [ ] Verify CORS origins
- [ ] Enable Sentry error tracking
- [ ] Test all security features

### Incident Response

1. **JWT Secret Compromise**: Rotate immediately, force re-auth
2. **Data Breach**: Check audit logs for unauthorized access
3. **DDoS**: Monitor rate limit violations via Sentry
4. **Account Compromise**: Check failed login attempts

---

## 7. Testing Security

```bash
# 1. Verify Helmet headers
curl -I http://localhost:4000/health
# Check: X-Frame-Options, X-Content-Type-Options

# 2. Test rate limiting (login endpoint)
for i in $(seq 1 7); do
  curl -X POST http://localhost:4000/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}'
done
# Expected: 401 (1-5), 429 (6+)

# 3. Verify JWT contains isSuperAdmin
TOKEN=$(curl -s -X POST http://localhost:4000/auth/login ... | jq -r .accessToken)
echo "$TOKEN" | cut -d'.' -f2 | base64 -d | jq .

# 4. Test CORS rejection
curl -X GET http://localhost:4000/health \
  -H "Origin: https://evil.com"
# Should fail with CORS error

# 5. Check audit logs
curl http://localhost:4000/audit/logs \
  -H "Authorization: Bearer $TOKEN"
```

---

## 8. References

- OWASP Top 10: https://owasp.org/Top10/
- JWT Best Practices: https://tools.ietf.org/html/rfc8949
- Helmet.js: https://helmetjs.github.io/
- Prisma Security: https://www.prisma.io/security

---

Last Updated: 2026-02-23
