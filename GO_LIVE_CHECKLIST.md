# BuildingOS Go/No-Go Launch Checklist

**Version**: 1.0
**Date**: February 18, 2026
**Target Launch Date**: [DATE TBD - requires all checks PASS]
**Status**: READY FOR TESTING

---

## Executive Summary

This is the **final verification checklist** before launching BuildingOS to production. All items must be verified by responsible parties. A single **FAIL** requires escalation and remediation before launch.

### Go/No-Go Decision Criteria

| Outcome | Meaning | Action |
|---------|---------|--------|
| **GO** | All checks PASS or have documented exceptions | Proceed to production launch |
| **NO-GO** | Any critical check FAIL or blocker found | Stop launch, fix issues, re-check |
| **GO with Caution** | All PASS but minor issues noted | Launch with enhanced monitoring |

---

## Checklist Structure

Each section has:
- ☐ Checkbox for completion
- **Owner**: Person responsible for verification
- **Evidence**: How to prove it works
- **Pass Criteria**: What counts as "pass"
- **Impact**: What breaks if this fails

---

## A) INFRASTRUCTURE & ENVIRONMENTS

### A1: Staging Environment Ready

- [ ] **Staging database**: Connected and accessible
  - **Owner**: DevOps/Platform Engineer
  - **Evidence**: `psql -h staging-db -c "SELECT 1;"`
  - **Pass Criteria**: Returns `1` immediately, no errors
  - **Impact**: Cannot test migrations or backup/restore

- [ ] **Staging API**: Running and responding
  - **Owner**: Platform Engineer
  - **Evidence**: `curl http://staging-api:3001/health`
  - **Pass Criteria**: Returns `{"status":"ok"}`
  - **Impact**: Cannot perform smoke tests

- [ ] **Staging app secrets**: Configured correctly
  - **Owner**: DevOps/Security
  - **Evidence**: Check `.env.staging` has all required vars
  - **Pass Criteria**: All vars present, no empty values, no production secrets
  - **Impact**: API startup fails or uses wrong config

### A2: Production Environment Ready

- [ ] **Production database**: Connected, backups enabled
  - **Owner**: DBA/Platform Engineer
  - **Evidence**: `psql -h prod-db -c "SELECT 1;"`
  - **Pass Criteria**: Returns `1` immediately, no errors, max_connections >= 100
  - **Impact**: Cannot connect, immediate launch failure

- [ ] **Production API server**: Ready to deploy
  - **Owner**: Platform Engineer
  - **Evidence**: SSH access confirmed, disk space >= 50GB, Docker/Node.js available
  - **Pass Criteria**: Can SSH in, can run `node --version`, disk available
  - **Impact**: Cannot deploy API

- [ ] **Production secrets**: Secure and ready
  - **Owner**: DevOps/Security
  - **Evidence**: `.env.production` in secure vault, not in Git
  - **Pass Criteria**: All required variables present, 64-character JWT_SECRET, HTTPS URLs only
  - **Impact**: API cannot start, security breach

- [ ] **Production S3/MinIO**: Configured and tested
  - **Owner**: DevOps/Infrastructure
  - **Evidence**: `aws s3 ls s3://buildingos-prod/` succeeds
  - **Pass Criteria**: Bucket accessible, versioning enabled, backups configured
  - **Impact**: Cannot store files, uploads fail

- [ ] **Production email service**: SMTP/SendGrid configured
  - **Owner**: DevOps/Platform
  - **Evidence**: Test email sent successfully
  - **Pass Criteria**: Email arrives in 30 seconds, no bounce
  - **Impact**: Invitations cannot be sent

### A3: Environment Variables & Boot Validation

- [ ] **Staging**: All env vars validated at boot
  - **Owner**: Platform Engineer
  - **Evidence**: Run `npm run build && npm start` on staging, watch for validation errors
  - **Pass Criteria**: API starts without "configuration error" messages
  - **Impact**: Invalid config causes startup failure

- [ ] **Production**: All env vars validated at boot
  - **Owner**: Platform Engineer
  - **Evidence**: Run `npm start` in production, watch logs for 30 seconds
  - **Pass Criteria**: See "BuildingOS API Started" log message, no config errors
  - **Impact**: Production cannot start

### A4: Health Endpoints Working

- [ ] **`/health` (liveness probe)**:
  - **Owner**: QA/Platform Engineer
  - **Evidence**: `curl http://api:3001/health`
  - **Pass Criteria**: Returns 200 OK, `{"status":"ok"}`
  - **Impact**: Kubernetes/Docker health checks fail, service restarts

- [ ] **`/readyz` (readiness probe)**:
  - **Owner**: QA/Platform Engineer
  - **Evidence**: `curl http://api:3001/readyz | jq '.status'`
  - **Pass Criteria**: Returns 200 OK with `"healthy"`, all checks `"up"`
  - **Impact**: Load balancer removes from rotation, requests fail

- [ ] **Database check in `/readyz`**:
  - **Owner**: QA/DBA
  - **Evidence**: `curl http://api:3001/readyz | jq '.checks.database'`
  - **Pass Criteria**: `"status": "up"`, latency < 50ms
  - **Impact**: Load balancer thinks DB is down

- [ ] **Storage check in `/readyz`**:
  - **Owner**: QA/DevOps
  - **Evidence**: `curl http://api:3001/readyz | jq '.checks.storage'`
  - **Pass Criteria**: `"status": "up"` or `"not_configured"`
  - **Impact**: File operations may fail silently

- [ ] **Email check in `/readyz`**:
  - **Owner**: QA/Platform
  - **Evidence**: `curl http://api:3001/readyz | jq '.checks.email'`
  - **Pass Criteria**: `"status": "up"` or `"not_configured"`
  - **Impact**: Email service failures not detected

---

## B) SECURITY

### B1: Rate Limiting

- [ ] **Login rate limit**: 5 attempts per 15 minutes
  - **Owner**: Security Engineer
  - **Evidence**: Try 6 logins in 15 min window, 6th should return 429
  - **Pass Criteria**: 6th login returns `429 Too Many Requests`
  - **Impact**: Brute force attacks possible

- [ ] **Signup rate limit**: 3 attempts per 1 hour
  - **Owner**: Security Engineer
  - **Evidence**: Try 4 signups in 1 hour from same IP, 4th should fail
  - **Pass Criteria**: 4th signup returns 429
  - **Impact**: Account creation spam possible

- [ ] **Invitation rate limit**: 10 per 15 minutes
  - **Owner**: Security Engineer
  - **Evidence**: Send 11 invitations in 15 min, 11th should fail
  - **Pass Criteria**: 11th invitation returns 429
  - **Impact**: Spam/enumeration attacks possible

### B2: CORS Configuration

- [ ] **CORS allows only configured origins**
  - **Owner**: Security Engineer
  - **Evidence**: `curl -H "Origin: attacker.com" http://api:3001/auth/me` returns CORS error
  - **Pass Criteria**: Response lacks `Access-Control-Allow-Origin` header
  - **Impact**: XSS from other domains possible

- [ ] **CORS credentials required**
  - **Owner**: Security Engineer
  - **Evidence**: Cookie/auth headers sent with cross-origin request
  - **Pass Criteria**: Credentials sent, no CORS errors
  - **Impact**: Authentication doesn't work cross-domain

### B3: Security Headers

- [ ] **X-Content-Type-Options**: nosniff
  - **Owner**: Security Engineer
  - **Evidence**: `curl -I http://api:3001/ | grep X-Content-Type-Options`
  - **Pass Criteria**: Returns `X-Content-Type-Options: nosniff`
  - **Impact**: MIME type sniffing attacks possible

- [ ] **X-Frame-Options**: DENY
  - **Owner**: Security Engineer
  - **Evidence**: `curl -I http://api:3001/ | grep X-Frame-Options`
  - **Pass Criteria**: Returns `X-Frame-Options: DENY`
  - **Impact**: Clickjacking attacks possible

- [ ] **Referrer-Policy**: strict-origin-when-cross-origin
  - **Owner**: Security Engineer
  - **Evidence**: `curl -I http://api:3001/ | grep Referrer-Policy`
  - **Pass Criteria**: Header present
  - **Impact**: Referrer leakage possible

### B4: Upload Security

- [ ] **File size limits enforced**: Max 10MB
  - **Owner**: Security Engineer
  - **Evidence**: Upload 11MB file, should fail
  - **Pass Criteria**: Returns 413 Payload Too Large
  - **Impact**: Disk space exhaustion attacks

- [ ] **MIME type validation**: Only approved types
  - **Owner**: Security Engineer
  - **Evidence**: Upload `.exe` file, should be rejected
  - **Pass Criteria**: Returns 400 Bad Request, "Invalid MIME type"
  - **Impact**: Malicious file uploads possible

- [ ] **Path traversal prevention**: No `../` in filenames
  - **Owner**: Security Engineer
  - **Evidence**: Upload file named `../../etc/passwd`, should be sanitized
  - **Pass Criteria**: File saved with sanitized name, not in parent directory
  - **Impact**: Arbitrary file write vulnerability

### B5: Token & Session Security

- [ ] **JWT tokens expire**: 24 hours
  - **Owner**: Security Engineer
  - **Evidence**: Create token, check `exp` claim, calculate expiry
  - **Pass Criteria**: exp = now + 86400 seconds
  - **Impact**: Compromised tokens valid indefinitely

- [ ] **Refresh tokens implemented**: 30 day lifetime
  - **Owner**: Security Engineer
  - **Evidence**: Check refresh token in database has `expiresAt` field
  - **Pass Criteria**: Field exists and set correctly
  - **Impact**: Long-term token compromise possible

- [ ] **Impersonation tokens**: Expire immediately after use
  - **Owner**: Security Engineer
  - **Evidence**: Use impersonation token twice, 2nd use fails
  - **Pass Criteria**: 2nd use returns 401 Unauthorized
  - **Impact**: Impersonation tokens can be reused

### B6: No Secrets in Repository

- [ ] **Git history clean**: No API keys, passwords
  - **Owner**: Security Engineer/DevOps
  - **Evidence**: `git log -p -- .env 2>/dev/null | grep -E "password|secret|key" | head -1`
  - **Pass Criteria**: No output (no secrets found)
  - **Impact**: Secrets exposed to anyone with Git access

- [ ] **`.env` files in `.gitignore`**
  - **Owner**: DevOps
  - **Evidence**: Check `.gitignore`, confirm `.env` listed
  - **Pass Criteria**: `.env*` in `.gitignore`
  - **Impact**: Secrets committed to repo

---

## C) DATA INTEGRITY

### C1: Backup System

- [ ] **Automatic backups enabled**
  - **Owner**: DBA/DevOps
  - **Evidence**: `ls -lh backups/backup_production_*.sql.gz | head -1`
  - **Pass Criteria**: At least one backup file exists, size > 100MB
  - **Impact**: Cannot recover from data loss

- [ ] **Backup retention configured**
  - **Owner**: DBA
  - **Evidence**: Check script has `BACKUP_RETENTION_DAILY=7` and `BACKUP_RETENTION_WEEKLY=28`
  - **Pass Criteria**: Both retention values set correctly
  - **Impact**: Backups deleted too early or never cleaned up

- [ ] **Backup checksums working**
  - **Owner**: QA
  - **Evidence**: Run `./scripts/backup-db.sh`, check metadata has `checksum_sha256`
  - **Pass Criteria**: Checksum generated and stored
  - **Impact**: Corrupt backups not detected

- [ ] **S3 upload tested**
  - **Owner**: DevOps
  - **Evidence**: Run `./scripts/backup-db.sh --upload --env production`, check S3
  - **Pass Criteria**: File appears in S3 within 60 seconds
  - **Impact**: Backups only on local disk, no offsite copy

### C2: Restore Procedure

- [ ] **Restore to staging tested at least once**
  - **Owner**: QA/DBA
  - **Evidence**: Successfully restored a production backup to staging
  - **Pass Criteria**: Restore completed, data verified, app started
  - **Impact**: Cannot recover in emergency

- [ ] **Restore validation working**
  - **Owner**: QA/DBA
  - **Evidence**: After restore, run verification (table count, smoke tests)
  - **Pass Criteria**: All tables restored, data consistent
  - **Impact**: Corrupted data not caught

- [ ] **Rollback procedure documented**
  - **Owner**: Platform Engineer
  - **Evidence**: RUNBOOK.md has clear rollback steps
  - **Pass Criteria**: Steps are clear, repeatable, tested
  - **Impact**: Cannot recover if restore goes wrong

### C3: Database Migrations

- [ ] **Latest migration applied to staging**
  - **Owner**: Platform Engineer
  - **Evidence**: Run `npm run migrate:status` on staging, shows all migrations applied
  - **Pass Criteria**: "All migrations are up to date"
  - **Impact**: Schema mismatch between staging and code

- [ ] **Migrate deploy (not dev) used in production**
  - **Owner**: Platform Engineer
  - **Evidence**: In RUNBOOK, instructions say `npm run migrate:deploy`
  - **Pass Criteria**: Documentation shows correct command
  - **Impact**: Development migrations interfere with production

- [ ] **Migration rollback plan documented**
  - **Owner**: Platform Engineer
  - **Evidence**: RUNBOOK.md has rollback instructions (restore from backup)
  - **Pass Criteria**: Clear steps to restore pre-migration backup
  - **Impact**: Cannot undo bad migration

### C4: Data Retention Implemented

- [ ] **Expired invitations cleanup**: Runs automatically
  - **Owner**: Platform Engineer
  - **Evidence**: Run `./scripts/cleanup-data.sh --dry-run`, see expired count
  - **Pass Criteria**: Shows expired invitations to delete
  - **Impact**: Database bloat with expired invitations

- [ ] **Old tokens cleanup**: Implemented (if applicable)
  - **Owner**: Platform Engineer
  - **Evidence**: Tokens with past `expiresAt` deleted automatically
  - **Pass Criteria**: Cleanup script targets tokens table
  - **Impact**: Dead tokens accumulate

- [ ] **AuditLog protection**: Never deleted
  - **Owner**: Platform Engineer/DBA
  - **Evidence**: Check cleanup script DOES NOT delete AuditLog
  - **Pass Criteria**: No AuditLog deletion in cleanup script
  - **Impact**: Legal compliance breach if logs deleted

---

## D) EMAIL SYSTEM

### D1: Email Delivery

- [ ] **Invitation email sent**: Real recipient receives email
  - **Owner**: QA/Product
  - **Evidence**: Create invitation, check test email account
  - **Pass Criteria**: Email arrives within 60 seconds with correct subject
  - **Impact**: Users cannot receive invitations

- [ ] **Email has correct links**: APP_BASE_URL used
  - **Owner**: QA
  - **Evidence**: Check email content, verify URL matches APP_BASE_URL
  - **Pass Criteria**: URL is `https://app-domain.com/invite?token=...` (not localhost)
  - **Impact**: Users click wrong/invalid links

- [ ] **Tenant branding applied** (if configured):
  - **Owner**: Product
  - **Evidence**: Check email template uses tenant brandName, primaryColor
  - **Pass Criteria**: Branding visible in email HTML
  - **Impact**: Unprofessional appearance, misses brand opportunity

### D2: Email Error Handling

- [ ] **Email failure doesn't break invitation**
  - **Owner**: QA/DevOps
  - **Evidence**: Stop SMTP server, create invitation, verify invitation created (email fails silently)
  - **Pass Criteria**: Invitation created successfully in DB, email error logged
  - **Impact**: Invitations blocked if email service down

- [ ] **Email logs recorded**: For audit trail
  - **Owner**: QA
  - **Evidence**: Create invitation, check EmailLog table has entry
  - **Pass Criteria**: EmailLog record with status="sent" or status="failed"
  - **Impact**: No audit trail of email attempts

- [ ] **Failed email alerts**: Monitored (optional)
  - **Owner**: Platform Engineer
  - **Evidence**: Email failure recorded in logs, monitoring checks for high failure rate
  - **Pass Criteria**: Failed email logged with timestamp and error message
  - **Impact**: Silent email failures go unnoticed

---

## E) OBSERVABILITY

### E1: Request Tracing

- [ ] **X-Request-Id generated**: Unique per request
  - **Owner**: QA
  - **Evidence**: `curl -v http://api:3001/buildings 2>&1 | grep X-Request-Id`
  - **Pass Criteria**: Response header shows `X-Request-Id: <uuid>`
  - **Impact**: Cannot trace individual requests

- [ ] **Request logging includes durationMs**:
  - **Owner**: QA
  - **Evidence**: Check logs contain `"durationMs": 123`
  - **Pass Criteria**: All requests logged with duration
  - **Impact**: Cannot measure performance

- [ ] **RequestId propagates through logs**:
  - **Owner**: QA
  - **Evidence**: Get requestId from header, search logs for it
  - **Pass Criteria**: Multiple log entries have same requestId
  - **Impact**: Cannot trace multi-step operations

### E2: Structured Logging

- [ ] **Logs are JSON in production**:
  - **Owner**: Platform Engineer
  - **Evidence**: Check logs are valid JSON, not plain text
  - **Pass Criteria**: `jq '.requestId' < logs/api.log` works
  - **Impact**: Cannot parse/search logs with tools

- [ ] **Sensitive data redacted**: No passwords/tokens in logs
  - **Owner**: Security Engineer
  - **Evidence**: Search logs for "password", "token", "secret"
  - **Pass Criteria**: No clear-text sensitive values found
  - **Impact**: Credentials exposed in logs

- [ ] **Log levels correct**: info/warn/error used appropriately
  - **Owner**: Platform Engineer
  - **Evidence**: Spot-check logs, see mix of levels
  - **Pass Criteria**: Normal operations at "info", errors at "error"
  - **Impact**: Cannot filter by severity

### E3: Error Tracking

- [ ] **Sentry receiving errors** (if configured):
  - **Owner**: DevOps/Platform Engineer
  - **Evidence**: Trigger 500 error in staging, check Sentry dashboard
  - **Pass Criteria**: Error appears in Sentry within 30 seconds
  - **Impact**: Silent errors go unnoticed

- [ ] **Error has context**: tenantId, userId, requestId
  - **Owner**: QA
  - **Evidence**: Check Sentry error details include tags/context
  - **Pass Criteria**: Can see which tenant/user/request caused error
  - **Impact**: Cannot debug multi-tenant issues

- [ ] **PII redacted in Sentry**: No passwords/tokens sent
  - **Owner**: Security Engineer
  - **Evidence**: Trigger error with sensitive data, check Sentry
  - **Pass Criteria**: Sensitive values show as `[REDACTED]`
  - **Impact**: Secrets exposed to Sentry (third-party)

### E4: Monitoring & Alerts

- [ ] **Error rate monitoring**: Alerted if > 10/min
  - **Owner**: DevOps
  - **Evidence**: Monitoring dashboard/alerts configured
  - **Pass Criteria**: Alert rule exists and is active
  - **Impact**: Error spikes go unnoticed

- [ ] **Database latency monitoring**: Alert if > 100ms
  - **Owner**: DevOps/DBA
  - **Evidence**: Monitoring dashboard shows DB latency metric
  - **Pass Criteria**: Metric available and alert configured
  - **Impact**: Slow queries degrade user experience

- [ ] **Backup success monitoring**: Alert if backup fails
  - **Owner**: DevOps
  - **Evidence**: Backup log monitoring or cron email alerts
  - **Pass Criteria**: Missing backup triggers alert
  - **Impact**: Missing backups go unnoticed until disaster

---

## F) PRODUCT CORE FUNCTIONALITY

### F1: Tenant Onboarding

- [ ] **Onboarding checklist visible**: For new tenants
  - **Owner**: Product/QA
  - **Evidence**: Create new tenant account, see onboarding card on dashboard
  - **Pass Criteria**: OnboardingCard component renders with steps
  - **Impact**: Users confused about initial setup

- [ ] **Onboarding steps auto-calculate**: Based on actual data
  - **Owner**: QA
  - **Evidence**: Create building, check onboarding progress updates
  - **Pass Criteria**: Step count decreases as data created
  - **Impact**: Manual tracking needed

- [ ] **Onboarding dismissible**: Don't show after completion
  - **Owner**: QA
  - **Evidence**: Dismiss onboarding, refresh page, it doesn't reappear
  - **Pass Criteria**: OnboardingCard hidden after all steps done
  - **Impact**: Card always visible, clutters UI

### F2: Roles & Context

- [ ] **Roles by scope implemented**: Building/Unit level
  - **Owner**: Product/QA
  - **Evidence**: Assign user OPERATOR role for specific building
  - **Pass Criteria**: User can only access that building
  - **Impact**: Users can access buildings they shouldn't

- [ ] **Context selector working**: Switch building/unit
  - **Owner**: QA
  - **Evidence**: Click building selector, switch building, data updates
  - **Pass Criteria**: All views update to show new building's data
  - **Impact**: Wrong building's data displayed

- [ ] **RESIDENT scope enforcement**: Can only see their units
  - **Owner**: QA/Security
  - **Evidence**: RESIDENT user tries to access other unit, gets access denied
  - **Pass Criteria**: Returns 404, no enumeration possible
  - **Impact**: RESIDENT users can see all units

### F3: Core Features

- [ ] **Buildings CRUD**: Create/read/update/delete
  - **Owner**: QA
  - **Evidence**: Create building, edit, delete, verify all work
  - **Pass Criteria**: All operations successful, data persists
  - **Impact**: Building management broken

- [ ] **Units CRUD**: Create/read/update/delete
  - **Owner**: QA
  - **Evidence**: Create unit in building, edit, delete, verify
  - **Pass Criteria**: All operations successful, data persists
  - **Impact**: Unit management broken

- [ ] **Occupants assignment**: OWNER/RESIDENT roles
  - **Owner**: QA
  - **Evidence**: Assign user to unit with role, verify access
  - **Pass Criteria**: User can access unit, has correct role permissions
  - **Impact**: Unit access control broken

- [ ] **Tickets full workflow**: Create/comment/resolve
  - **Owner**: QA
  - **Evidence**: Create ticket, add comment, change status to RESOLVED
  - **Pass Criteria**: All operations work, state machine enforced
  - **Impact**: Ticket system broken

- [ ] **Communications**: Send messages to tenants/units
  - **Owner**: QA
  - **Evidence**: Send communication, verify recipient receives
  - **Pass Criteria**: Message created, recipient can view in inbox
  - **Impact**: Communication system broken

- [ ] **Documents**: Upload/download files
  - **Owner**: QA
  - **Evidence**: Upload document, download it, verify integrity
  - **Pass Criteria**: Downloaded file matches original
  - **Impact**: File storage broken

- [ ] **Vendors management**: CRUD vendors, quotes, work orders
  - **Owner**: QA
  - **Evidence**: Create vendor, create quote, create work order
  - **Pass Criteria**: All created and linked correctly
  - **Impact**: Vendor management broken

- [ ] **Finances**: Charges, payments, allocations
  - **Owner**: QA
  - **Evidence**: Create charge, create payment, allocate to charge
  - **Pass Criteria**: Payment reduces charge balance correctly
  - **Impact**: Financial tracking broken

### F4: Multi-Tenant Isolation

- [ ] **Cross-tenant access prevented**: User A cannot see Tenant B data
  - **Owner**: Security/QA
  - **Evidence**: User from Tenant A tries to access Tenant B buildings API
  - **Pass Criteria**: Returns 404 (not 403, prevent enumeration)
  - **Impact**: Data breach across tenants

- [ ] **Audit logs show tenantId**: For security/compliance
  - **Owner**: QA
  - **Evidence**: Create resource, check AuditLog has correct tenantId
  - **Pass Criteria**: AuditLog entry includes tenantId
  - **Impact**: Cannot track which tenant did what

- [ ] **Database queries filtered by tenantId**: In all services
  - **Owner**: Security/Code Review
  - **Evidence**: Code review confirms all queries include tenantId filter
  - **Pass Criteria**: No query returns data across tenants
  - **Impact**: Data breach possible

---

## G) SUPER-ADMIN & CONTROL PLANE

### G1: Super-Admin Separation

- [ ] **Super-admin cannot access tenant UI**: Redirects to control plane
  - **Owner**: Security/QA
  - **Evidence**: Login as super-admin, navigate to /{tenantId}/dashboard, redirected to /super-admin
  - **Pass Criteria**: Always redirected to control plane
  - **Impact**: Super-admin accidentally accesses tenant data

- [ ] **Super-admin impersonation logged**: In AuditLog
  - **Owner**: QA
  - **Evidence**: Super-admin impersonates tenant, check AuditLog
  - **Pass Criteria**: AuditLog shows SUPER_ADMIN_IMPERSONATION action
  - **Impact**: No trail of impersonation

- [ ] **Impersonation token expires**: After use or timeout
  - **Owner**: Security/QA
  - **Evidence**: Use impersonation token to login, verify 2nd use fails
  - **Pass Criteria**: 2nd use returns 401 Unauthorized
  - **Impact**: Tokens can be reused

### G2: Control Plane Features

- [ ] **Tenant management CRUD**: Create/read/update/delete
  - **Owner**: QA
  - **Evidence**: Create tenant, view in list, edit settings, delete
  - **Pass Criteria**: All operations successful
  - **Impact**: Cannot manage customers

- [ ] **Subscription management**: View and change plans
  - **Owner**: Product/QA
  - **Evidence**: Change tenant subscription plan, verify limits enforced
  - **Pass Criteria**: Subscription changed, new limits take effect
  - **Impact**: Cannot manage licensing

- [ ] **Usage tracking**: Buildings, units, users limits
  - **Owner**: QA
  - **Evidence**: Create resources, watch usage progress bars
  - **Pass Criteria**: Progress bars update correctly as resources created
  - **Impact**: Limits not enforced

- [ ] **Audit logs accessible**: Filter by tenant/user/action
  - **Owner**: QA
  - **Evidence**: Query audit logs with filters
  - **Pass Criteria**: Results filtered correctly
  - **Impact**: Cannot investigate security incidents

---

## H) GO/NO-GO DECISION

### Summary Table

| Category | Owner | Status | Notes |
|----------|-------|--------|-------|
| **A. Infrastructure** | DevOps | ☐ | |
| **B. Security** | Security Eng | ☐ | |
| **C. Data** | DBA/Platform | ☐ | |
| **D. Email** | Platform | ☐ | |
| **E. Observability** | Platform | ☐ | |
| **F. Product Core** | QA/Product | ☐ | |
| **G. Super-Admin** | QA/Security | ☐ | |

### Final Go/No-Go Decision

**Prepared by**: _________________________ Date: _________

**Verified by**: _________________________ Date: _________

**Approved by**: _________________________ Date: _________

**Decision**:

- [ ] **GO** - All checks PASS, launch approved
- [ ] **NO-GO** - Issues found, launch blocked
- [ ] **GO with Caution** - All pass, minor issues noted

**Issues/Exceptions** (if NO-GO or Caution):

```
1. [Issue]: [Description]
   [Resolution/Plan]:
   [Target Date]:

2. ...
```

**Rollback Plan** (if issues arise post-launch):

```
1. Stop accepting new requests (DNS/LB change)
2. Restore database from pre-launch backup
3. Revert application to previous version
4. Restore to [DATE/TIME]
5. Notify customers: [MESSAGE]
```

**Launch Execution Checklist** (only if GO):

- [ ] Send launch announcement to team
- [ ] Monitor /readyz every 5 minutes for first hour
- [ ] Watch error rate in Sentry/logs (alert if > 10/min)
- [ ] Check database latency (alert if > 100ms)
- [ ] Verify backup jobs run
- [ ] Monitor customer support tickets
- [ ] Post-launch review meeting scheduled: [DATE]

---

## Post-Launch Monitoring (First 24 Hours)

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| API Uptime | < 99% | Page oncall |
| Error Rate | > 10/min | Check Sentry, investigate |
| DB Latency | > 100ms | Check query logs, page DBA |
| Backup Success | Failed | Page DevOps |
| Email Failures | > 50/hour | Check SMTP logs |

---

## Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Platform Lead | | | |
| Security Lead | | | |
| Product Lead | | | |
| DevOps Lead | | | |
| VP Engineering | | | |

---

**Approved**: ☐ YES  ☐ NO

**Launch Date**: ___________________

**Go Live URL**: https://app.buildingos.local/

**Support Contact**: [NAME] [PHONE] [EMAIL]

