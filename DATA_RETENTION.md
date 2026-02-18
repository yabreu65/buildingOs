# BuildingOS Data Retention Policy

**Version**: 1.0
**Effective Date**: February 18, 2026
**Status**: Active

Defines how long different types of data are retained in BuildingOS production systems. Balances legal/compliance requirements with storage costs and performance.

## Executive Summary

| Data Type | Retention | Policy | Deletion |
|-----------|-----------|--------|----------|
| **Transaction Data** | Indefinite | Permanent | Never (unless legal order) |
| **Audit Logs** | Indefinite | Append-only | Never |
| **User Data** | Account Lifetime + 90 days | Retained while active | 90 days after deletion |
| **Invitations (Expired)** | Immediate | Delete when EXPIRED | Automatic |
| **Invitations (Revoked)** | 90 days | Auto-delete old | Automatic monthly |
| **Email Logs (Failed)** | 30 days | Delete if failed | Automatic monthly |
| **Email Logs (Sent)** | 90 days | Delete old successful | Automatic quarterly |
| **File Uploads** | 7+ years | Based on document type | Manual only |
| **Backups (Daily)** | 7 days | Auto-rotate | After 7 days |
| **Backups (Weekly)** | 28 days | Auto-rotate | After 28 days |

---

## Core Principles

### 1. **Audit Logs are Append-Only**

**Rule**: AuditLog table MUST NEVER have rows deleted, except by explicit legal/compliance order.

**Rationale**:
- Legal liability: SarbOx compliance, litigation discovery
- Security: Track all user actions for forensics
- Regulatory: GDPR requires action history

**Implementation**:
- No automatic deletion of AuditLog
- If deletion required, must be approved by:
  - Legal department
  - VP Compliance
  - CISO
  - CEO

**Verification**:
```sql
-- AuditLog should always grow
SELECT COUNT(*) FROM "AuditLog";  -- Only increases, never decreases
SELECT DATE(max("createdAt")) FROM "AuditLog";  -- Recent date
```

### 2. **Transaction Data is Permanent**

**Rule**: Core business data (Buildings, Units, Users, Payments, Tickets) retained indefinitely.

**Rationale**:
- Business continuity: Needed to operate
- Legal: May be needed for disputes/audits
- User expectations: Pay bills, own property, create requests forever

**Data included**:
- Buildings
- Units
- Users / Tenants
- Payments
- Charges
- Tickets
- Communications
- Documents

**Deletion**: Only if:
- User requests data deletion (GDPR right to be forgotten)
- Account terminated with explicit data deletion policy
- Legal order requires deletion

### 3. **Minimize Temporary Data**

**Rule**: Temporary/session data deleted as soon as no longer needed.

**Data included**:
- Login sessions (cleared on logout)
- Invitation tokens (deleted after acceptance/expiration)
- Password reset tokens (deleted after use/expiration)
- Impersonation tokens (deleted immediately after use)

---

## Detailed Retention Schedules

### A. Invitations (Temporary Credentials)

```
Status          Retention       Action
─────────────────────────────────────────────
PENDING         7 days          Expire automatically
EXPIRED         0 days          Delete immediately
ACCEPTED        90 days         Keep for audit trail, then delete
REVOKED         90 days         Keep, then delete
```

**Rationale**: Invitations are single-use credentials; no value after acceptance/expiration

**Cleanup Script**:
```bash
# Expired invitations (EXPIRED status)
DELETE FROM "Invitation"
WHERE status = 'EXPIRED'
  AND "expiresAt" < NOW();

# Old accepted invitations (keep 90 days for audit trail)
DELETE FROM "Invitation"
WHERE status = 'ACCEPTED'
  AND "createdAt" < NOW() - INTERVAL '90 days';

# Old revoked invitations
DELETE FROM "Invitation"
WHERE status = 'REVOKED'
  AND "createdAt" < NOW() - INTERVAL '90 days';
```

**Schedule**: Daily at 03:00 UTC (via `cleanup-data.sh`)

### B. Email Logs

```
Status          Retention       Rationale
─────────────────────────────────────────────
sent            90 days         Delivery proof
failed          30 days         Troubleshooting info
bounce          30 days         Address validation
complaint       365 days        Abuse tracking (keep 1 year)
```

**Rationale**:
- Successful sends: Keep 90 days for user support ("did you send?")
- Failed sends: Keep 30 days for troubleshooting (retry patterns, auth failures)
- Bounces/Complaints: Keep longer (address validation, abuse tracking)

**Cleanup SQL**:
```sql
-- Failed emails older than 30 days
DELETE FROM "EmailLog"
WHERE status = 'failed'
  AND "createdAt" < NOW() - INTERVAL '30 days';

-- Successful emails older than 90 days
DELETE FROM "EmailLog"
WHERE status = 'sent'
  AND "createdAt" < NOW() - INTERVAL '90 days';

-- Keep complaints 1 year for spam tracking
-- DO NOT DELETE complaints until 365 days
```

**Storage Impact**: Assuming 1000 emails/day, ~30MB/month in logs

**Schedule**: Monthly on 1st at 03:00 UTC

### C. User Sessions & Tokens

```
Type            Retention       Method
─────────────────────────────────────────
API Tokens      Until logout    Auto-delete on logout
Refresh Tokens  30 days         Expires automatically
Session Cookie  1 day           Expires automatically
2FA Codes       15 min          Expires automatically
```

**Implementation**: Database level via `expiresAt` field
```typescript
// Check and delete expired tokens in background
DELETE FROM "RefreshToken"
WHERE "expiresAt" < NOW();
```

**Note**: Tokens are lightweight; expiration is automatic, not actively cleaned

### D. Files & Documents

```
Type                    Retention           Note
─────────────────────────────────────────────────
Building Documents      7+ years            Legally required
Tenant Documents        7+ years            Tax/financial
Unit Leases/Deeds       Indefinite          Property records
System Logs             30 days             S3 log retention
Temp Uploads            1 day               Cleanup before finalization
```

**Implementation**: S3 bucket lifecycle policy
```json
{
  "Rules": [
    {
      "ID": "DeleteTempUploads",
      "Filter": { "Prefix": "temp/" },
      "Expiration": { "Days": 1 },
      "Status": "Enabled"
    },
    {
      "ID": "DeleteOldLogs",
      "Filter": { "Prefix": "logs/" },
      "Expiration": { "Days": 30 },
      "Status": "Enabled"
    }
  ]
}
```

**Glacier Archive**: No archival initially; plan for 90-day retention at archive tier if needed

### E. Backup Retention

```
Type                    Retention           Purpose
─────────────────────────────────────────────────────
Daily Backups           7 days              Quick recovery
Weekly Backups          28 days             Monthly recency
Full Backups (Monthly)  1 year (optional)   Long-term retention
```

**Implementation**: Automatic rotation in `backup-db.sh`
```bash
BACKUP_RETENTION_DAILY=7
BACKUP_RETENTION_WEEKLY=28
```

**Storage Cost**:
- Daily (245MB × 7 days) = 1.7 GB
- Weekly (250MB × 4 weeks) = 1 GB
- Total: ~2.7 GB in S3 (cost: ~$0.06/month)

**Schedule**: Daily at 02:00 UTC, weekly at 02:00 UTC Sundays

### F. Audit Logs (NEVER DELETE)

```
Content                 Retention           Reason
─────────────────────────────────────────────────────
Login attempts          Indefinite          Security audit trail
Building changes        Indefinite          Compliance
User role changes       Indefinite          Access control audit
Data exports            Indefinite          Security compliance
All admin actions       Indefinite          SarbOx/legal
```

**Query for retention verification**:
```sql
-- Oldest audit entry
SELECT MIN("createdAt") FROM "AuditLog";

-- Recent entries (should be many)
SELECT COUNT(*) FROM "AuditLog"
WHERE "createdAt" > NOW() - INTERVAL '1 day';

-- Audit log growth rate
SELECT DATE("createdAt"), COUNT(*) FROM "AuditLog"
GROUP BY DATE("createdAt")
ORDER BY DATE("createdAt") DESC LIMIT 30;
```

**Protection**: Set database constraints to prevent accidental deletion
```sql
-- REVOKE DELETE permission on AuditLog (optional, but recommended)
-- Only CISO/DBA/Legal can delete with explicit reason
REVOKE DELETE ON "AuditLog" FROM readonly_role;
```

---

## Compliance & Legal

### GDPR Compliance

**Right to Be Forgotten (Article 17)**:

When user requests data deletion:
```
1. Find all user data:
   - User record
   - All Invitations for this user
   - All Tickets created by user
   - All Communications from user
   - All access logs (kept for 90 days min)

2. Anonymize instead of delete (preferred):
   - Set user.email = NULL
   - Set user.phone = NULL
   - Delete personally identifiable information
   - Keep transaction history (GDPR allows if needed for contract)

3. Delete if possible:
   - Invitation tokens (not needed after user deleted)
   - Email logs related to user (30-90 days retention)
   - User preferences/settings

4. CANNOT delete:
   - AuditLog (legal obligation)
   - Transaction records (contract history)
   - Payments (tax/accounting requirement)
```

**Data Processing Agreement (DPA)**:
- Ensure all processors (S3, email service, Sentry) have DPA
- Document data flows to subprocessors
- Maintain data processing inventory

### SarbOx Compliance (US Public Companies)

**Requirement**: Audit trails must be immutable and complete

**Implementation**:
- AuditLog with immutable schema
- Cryptographic signing (optional enhancement)
- 7-year retention minimum (we do indefinite)
- No user access to delete audit logs

### HIPAA (Health-related data, if applicable)

- Encryption at rest (PostgreSQL SSL + S3 encryption)
- Encryption in transit (HTTPS only)
- Access controls (RBAC with audit)
- 6-year retention if health data stored

---

## Execution

### Automatic Cleanup

**File**: `scripts/cleanup-data.sh`

```bash
# Daily dry-run to preview deletions
0 3 * * * ./scripts/cleanup-data.sh --dry-run >> cleanup-preview.log 2>&1

# Monthly actual cleanup (1st of month, 03:00 UTC)
0 3 1 * * ./scripts/cleanup-data.sh --live >> cleanup-actual.log 2>&1
```

**Monitoring**:
```bash
# Check cleanup logs
tail -f cleanup-actual.log

# Verify deletions
psql -c "SELECT COUNT(*) FROM \"Invitation\" WHERE status='EXPIRED';"
# Should return 0 after cleanup
```

### Manual Cleanup

**For testing or emergency**:

```bash
# Preview what would be deleted
./scripts/cleanup-data.sh --dry-run --env staging

# Actually delete (staging)
./scripts/cleanup-data.sh --live --env staging

# Production requires explicit --force
./scripts/cleanup-data.sh --live --env production
```

### Verification Queries

**Run monthly to verify retention**:

```sql
-- Check invitation counts
SELECT status, COUNT(*) as count
FROM "Invitation"
GROUP BY status;

-- Check email log counts
SELECT status, COUNT(*) as count
FROM "EmailLog"
GROUP BY status;

-- Check audit log is growing (never shrinking)
SELECT COUNT(*) FROM "AuditLog";

-- Check backup count
SELECT COUNT(*) FROM pg_stat_user_tables
WHERE relname = 'AuditLog';
```

---

## Data Subject Access Requests (DSAR)

**When user requests: "Give me all data you have about me"**

```bash
# 1. Find user
psql -c "SELECT * FROM \"User\" WHERE email = 'user@example.com';"

# 2. Get all related data
SELECT * FROM "Invitation" WHERE email = 'user@example.com';
SELECT * FROM "Ticket" WHERE "createdByUserId" = 'user-id';
SELECT * FROM "Membership" WHERE "userId" = 'user-id';
SELECT * FROM "AuditLog" WHERE "userId" = 'user-id';

# 3. Export to JSON/CSV
psql -c "COPY (SELECT * FROM ...) TO STDOUT WITH CSV HEADER;" > user-data.csv

# 4. Encrypt and send securely
gpg --encrypt --armor --recipient user@example.com user-data.csv

# 5. Log the DSAR in audit trail
INSERT INTO "AuditLog" (...) VALUES ('DSAR_SUBMITTED', ...);
```

**Timeline**: 30 days to respond (GDPR requirement)

---

## Storage & Cost Analysis

### Current Storage Usage (Estimate)

| Data | Size | Growth | Cost/mo |
|------|------|--------|---------|
| PostgreSQL (prod) | 2 GB | +100MB/mo | $0.50 |
| Backups (S3) | 2.7 GB | +100MB/mo | $0.06 |
| Email Logs | 30 MB | +30MB/mo | $0.001 |
| Documents (S3) | 10 GB | +1GB/mo | $0.24 |
| **Total** | **14.7 GB** | **~1.2 GB/mo** | **$0.80/mo** |

### Projected 3-Year Cost

```
Year 1:  $0.80/mo × 12 = $9.60
Year 2:  $1.50/mo × 12 = $18.00  (more data)
Year 3:  $2.50/mo × 12 = $30.00  (more data)
────────────────────────────
Total:                    $57.60  (negligible)
```

**Cost optimization**: Archive to Glacier after 1 year (if needed)

---

## Audit & Compliance Checklist

- [ ] Verify AuditLog growth rate monthly
- [ ] Run retention verification queries quarterly
- [ ] Test backup restore annually
- [ ] Review DSAR process quarterly
- [ ] Update DPA with any new processors
- [ ] Annual retention policy review

---

## Appendix: Migration from Temporary Storage

**If implementing S3 lifecycle policies**:

```json
{
  "Rules": [
    {
      "ID": "DeleteTempFiles",
      "Filter": {
        "Prefix": "uploads/temp/"
      },
      "Expiration": {
        "Days": 1
      },
      "Status": "Enabled"
    },
    {
      "ID": "TransitionToGlacier",
      "Filter": {
        "Prefix": "documents/archive/"
      },
      "Transitions": [
        {
          "Days": 365,
          "StorageClass": "GLACIER"
        }
      ],
      "Status": "Enabled"
    },
    {
      "ID": "DeleteOldLogs",
      "Filter": {
        "Prefix": "logs/"
      },
      "Expiration": {
        "Days": 90
      },
      "Status": "Enabled"
    }
  ]
}
```

---

**Last Reviewed**: February 18, 2026
**Next Review**: August 18, 2026
**Owner**: Infrastructure Team
**Approver**: VP Engineering + Legal
