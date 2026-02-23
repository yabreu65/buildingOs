# 🔧 PILOT CHECKLIST - Operational Procedures for First Customer

**Date**: February 23, 2026
**Status**: 🟢 **PRODUCTION READY**
**Purpose**: Ensure first customer deployment has zero-surprise recovery procedures

---

## Quick Reference Card (Print This)

| Procedure | Command | Time | Risk |
|-----------|---------|------|------|
| **Backup** | `./scripts/backup-db.sh --env production` | 2-5 min | Low |
| **Restore (staging)** | `./scripts/restore-db.sh backups/backup_*.sql.gz` | 3-10 min | Low |
| **Restore (prod)** | `./scripts/restore-db.sh backups/backup_*.sql.gz --env production --force` | 5-15 min | 🔴 HIGH |
| **Rotate secrets** | `./scripts/rotate-secrets.sh` | 5 min | Medium |
| **View logs (requestId)** | `grep "550e8400-e29b" /var/log/buildingos/api.log` | <1 sec | Low |
| **View logs (tenantId)** | `grep "tenant-123" /var/log/buildingos/api.log` | <1 sec | Low |
| **Rollback deploy** | `./scripts/deploy.sh --version v0.1.0` | 2-5 min | Low |

---

# PART 1: DATABASE BACKUP

## 1.1 Backup Strategy

### Retention Policy
```
Daily backups: Last 7 days (keep 7 files)
Weekly backups: Last 4 weeks (keep 4 files)
Total retention: 28 days

Rotation: Automatic (script removes old files)
```

### When to Backup

| Timing | Frequency | When |
|--------|-----------|------|
| **Automatic** | Daily | 02:00 UTC (production) |
| **Pre-deployment** | Per release | Before npm run deploy |
| **Pre-migration** | Per migration | Before npm run migrate:deploy |
| **Manual** | On demand | Before major operations |

---

## 1.2 Automatic Daily Backup (Cron)

### Setup Cron Job

```bash
# Edit crontab
crontab -e

# Add this line (runs at 02:00 UTC every day)
0 2 * * * /home/buildingos/scripts/backup-db.sh --upload --env production >> /var/log/buildingos/backup.log 2>&1

# Verify cron was added
crontab -l | grep backup-db.sh
```

### Cron Log Monitoring

```bash
# View recent cron executions
grep CRON /var/log/syslog | grep backup-db.sh | tail -10

# View backup-specific logs
tail -50 /var/log/buildingos/backup.log

# Check if cron job ran successfully
ls -lh /home/buildingos/backups/backup_production_*.sql.gz | tail -3
# Should show today's backup
```

---

## 1.3 Manual Pre-Deployment Backup

```bash
# Before any major operation:

# 1. SSH to production server
ssh prod@buildingos-api.yourdomain.com

# 2. Create manual backup
./scripts/backup-db.sh --upload --env production

# Expected output:
# [✓] Backup started: backup_production_20260223_154532.sql.gz
# [✓] Database backed up: 1.2 GB
# [✓] Checksum: 5d41402abc4b2a76b9719d911017c592
# [✓] Uploading to S3: buildingos-backups/backup_production_20260223_154532.sql.gz
# [✓] Upload complete
# [✓] Backup retained (retention: daily=7, weekly=28)
```

---

## 1.4 Verify Backup Integrity

```bash
# Check backup file exists and has content
ls -lh backups/backup_production_*.sql.gz | head -3

# Check backup metadata
cat backups/metadata/backup_production_20260223_154532.json

# Expected metadata:
{
  "timestamp": "2026-02-23T15:45:32Z",
  "size_bytes": 1250000000,
  "database": "buildingos",
  "environment": "production",
  "checksum_sha256": "5d41402abc4b2a76b9719d911017c592",
  "tables_backed_up": 45,
  "rows_backed_up": 152000
}

# Validate checksum (if on same server)
sha256sum -c backups/metadata/backup_production_20260223_154532.json

# Expected: OK
```

---

## 1.5 S3/MinIO Backup Verification

```bash
# List backups in S3 (if using AWS S3)
aws s3 ls s3://buildingos-backups/ --recursive | head -10

# OR with MinIO (if using MinIO)
mc ls minio/buildingos-backups/

# Expected: Multiple backup files with timestamps
```

---

# PART 2: DATABASE RESTORE

## ⚠️ CRITICAL: Restore Safety Rules

```
RULE 1: Never restore to production without --force flag + explicit yes confirmation
RULE 2: Test restore procedure on staging first (before production emergency)
RULE 3: Create pre-restore backup snapshot (restore script does this automatically)
RULE 4: After restore, run smoke tests to verify data integrity
RULE 5: Notify stakeholders of restore action
```

---

## 2.1 Restore to Staging (Safe - Test First)

```bash
# 1. List available backups
ls -lh backups/backup_*.sql.gz

# 2. Choose backup to restore
BACKUP_FILE="backups/backup_production_20260223_154532.sql.gz"

# 3. Restore to staging (no --force needed, safe)
./scripts/restore-db.sh $BACKUP_FILE --env staging

# Expected output:
# [INFO] Restore starting for environment: staging
# [INFO] Validating backup file...
# [✓] Backup valid: 1.2 GB
# [INFO] Creating pre-restore snapshot...
# [✓] Pre-restore snapshot: backup_staging_snapshot_20260223_154600.sql.gz
# [INFO] Clearing staging database...
# [✓] Staging database cleared
# [INFO] Restoring from backup...
# [✓] Database restored: 152000 rows
# [✓] Restore complete in 8.5 seconds

# 4. Verify restored data
psql -U buildingos -d buildingos_staging -c "SELECT COUNT(*) FROM \"User\";"
# Should show expected user count
```

---

## 2.2 Restore to Production (Emergency Only)

### Prerequisites
```bash
# 1. You have explicit authorization from stakeholders
# 2. You have a valid, tested backup file
# 3. You have completed restore test on staging (2.1 above)
# 4. You understand the data loss: restore point = backup time
```

### Restore Procedure

```bash
# 1. Notify team (Slack, email)
# Message: "⚠️  INCIDENT: Starting production database restore from backup_production_20260223_154532.sql.gz"

# 2. Put API in maintenance mode (if your infrastructure supports this)
# OR: Tell customers "API will be offline 5-15 minutes"

# 3. Create final backup (before restore destroys current data)
./scripts/backup-db.sh --env production
# Save this backup separately: backup_production_CORRUPTED_20260223_160000.sql.gz
# (Keep corrupted data for forensics later)

# 4. Stop API services
systemctl stop buildingos-api
systemctl stop buildingos-worker  # if using job queues

# 5. Restore production database
BACKUP_FILE="backups/backup_production_20260223_154532.sql.gz"
./scripts/restore-db.sh $BACKUP_FILE --env production --force

# When prompted:
# "Restoring to PRODUCTION. This will overwrite current data."
# "Type 'yes' to confirm:"
# (Type: yes)

# Expected: Same output as staging restore

# 6. Verify restored data
psql -U buildingos -d buildingos -c "SELECT COUNT(*) FROM \"User\";"

# 7. Restart API services
systemctl start buildingos-api
systemctl start buildingos-worker

# 8. Run smoke tests
curl http://localhost:4000/health
# Expected: {"status":"ok",...}

# 9. Notify team (Slack, email)
# Message: "✅ RECOVERY: Production database restored successfully. All systems operational."
```

---

## 2.3 Point-in-Time Recovery Scenarios

### Scenario A: Customer Accidentally Deleted Unit

```bash
# 1. When did deletion happen? Ask customer
# Customer: "Around 14:30 UTC today (Feb 23)"

# 2. Find backup before 14:30
ls -lh backups/backup_production_*.sql.gz
# Find file created before 14:30 (e.g., backup_production_20260223_020000.sql.gz)

# 3. Restore to staging, extract data
./scripts/restore-db.sh backups/backup_production_20260223_020000.sql.gz --env staging

# 4. Query deleted unit
psql -U buildingos -d buildingos_staging -c \
  "SELECT * FROM \"Unit\" WHERE id='unit-abc123';"

# 5. Manually restore unit from staging to production
# OR restore full production (if only this one deletion)
```

---

## 2.4 Test Restore Procedure (Monthly)

```bash
# Monthly: Test the restore procedure on staging to ensure it works

# 1. Select most recent production backup
LATEST_BACKUP=$(ls -1t backups/backup_production_*.sql.gz | head -1)

# 2. Restore to staging (practice)
./scripts/restore-db.sh $LATEST_BACKUP --env staging

# 3. Run smoke tests
psql -U buildingos -d buildingos_staging -c "SELECT COUNT(*) FROM \"User\";"
psql -U buildingos -d buildingos_staging -c "SELECT COUNT(*) FROM \"Tenant\";"

# 4. Document results
cat >> docs/release/RESTORE_TEST_LOG.txt << EOF
Date: $(date -u)
Backup: $LATEST_BACKUP
Staging restore: ✅ OK
Rows verified: ✅ OK
EOF

# 5. Clean up staging database (restore pre-restore snapshot)
# OR: Delete and recreate empty database
```

---

# PART 3: SECRET ROTATION

## 3.1 Secrets Management Overview

### Current Secrets (Track These)

| Secret | Location | Rotation Frequency | Impact |
|--------|----------|-------------------|--------|
| `JWT_SECRET` | .env file | Every 90 days OR if exposed | All tokens become invalid |
| `S3_SECRET_KEY` | .env file | Every 6 months | S3 access lost |
| `DATABASE_PASSWORD` | PostgreSQL user | Every 6 months | DB connection fails |
| `MAIL_PROVIDER_KEY` | .env file | Per-provider (e.g., Resend key) | Emails stop working |
| `SENTRY_DSN` | .env file | Low risk, optional | Error tracking stops |

---

## 3.2 Rotate JWT_SECRET (Most Important)

### When to Rotate JWT_SECRET
```
Immediately if: Secret exposed, leaked in logs, pushed to Git
Quarterly: Every 90 days (planned maintenance)
```

### Step-by-Step Rotation

```bash
# 1. Generate new secret (64+ characters for production)
NEW_JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
echo "New secret: $NEW_JWT_SECRET"

# 2. Backup current .env
cp .env .env.backup.$(date +%s)

# 3. Update .env with new secret
# Option A: Manual edit
vim .env
# Change: JWT_SECRET=<old_value> → JWT_SECRET=$NEW_JWT_SECRET

# Option B: Automated update
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$NEW_JWT_SECRET/" .env

# 4. Verify update
grep JWT_SECRET .env

# 5. Restart API (old tokens will be invalid, users must re-login)
systemctl restart buildingos-api

# 6. Monitor for login errors (expected)
# Error spike in AUTH_FAILED_LOGIN is normal (old tokens rejected)
# Monitor: tail -f /var/log/buildingos/api.log | grep AUTH_FAILED_LOGIN

# 7. Notify users (email or in-app message)
# Message: "Security update: Please log in again"

# 8. Document rotation
cat >> docs/release/SECRET_ROTATION_LOG.txt << EOF
Date: $(date -u)
Secret: JWT_SECRET
Action: Rotated (quarterly)
Status: ✅ OK
EOF
```

### What Happens After JWT_SECRET Rotation

```
Before:  All existing JWT tokens become invalid (good for security)
After:   Users automatically logged out, must log in again with new JWT
         API continues working normally
         No data loss
```

---

## 3.3 Rotate S3_SECRET_KEY

```bash
# 1. Generate new S3 key in AWS Console (or MinIO)
# AWS S3: IAM → Users → buildingos → Create new access key

# 2. Update .env
sed -i "s/S3_SECRET_KEY=.*/S3_SECRET_KEY=<new_key>/" .env

# 3. Test S3 access
aws s3 ls s3://buildingos-uploads/ --region us-east-1
# Expected: List of files (no error)

# 4. Restart API
systemctl restart buildingos-api

# 5. Test file upload via API
curl -X POST http://localhost:4000/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test.pdf"
# Expected: 201 Created (file uploaded)

# 6. Delete old S3 key in AWS Console
```

---

## 3.4 Rotate DATABASE_PASSWORD

⚠️ **High Risk**: Will break DB connections. Requires downtime.

```bash
# 1. Choose maintenance window (announce 1 week ahead)
# 2. Stop all API instances
systemctl stop buildingos-api

# 3. Change PostgreSQL password
psql -U postgres -c "ALTER ROLE buildingos WITH PASSWORD 'NewSecurePassword123!';"

# 4. Update .env
# Find CONNECTION STRING and update password:
# Before: postgresql://buildingos:OLD_PASS@localhost:5432/buildingos
# After:  postgresql://buildingos:NewSecurePassword123!@localhost:5432/buildingos

sed -i "s/buildingos:.*@/buildingos:NewSecurePassword123!@/" .env

# 5. Restart API
systemctl start buildingos-api

# 6. Verify connection works
curl http://localhost:4000/health
# Expected: {"status":"ok",...}
```

---

## 3.5 Secrets Rotation Schedule

```bash
# Add to crontab for quarterly reminders

# Quarterly JWT rotation (every 90 days)
0 0 23 2 * /home/buildingos/scripts/remind-jwt-rotation.sh

# Semi-annual S3/DB rotation
0 0 1 1,7 * /home/buildingos/scripts/remind-db-rotation.sh
```

---

# PART 4: LOG TROUBLESHOOTING

## 4.1 Log Locations

```bash
# API logs
/var/log/buildingos/api.log          # Main API logs (JSON format in prod)
/var/log/buildingos/api.error.log    # Error logs only

# Database logs (if PostgreSQL running locally)
/var/log/postgresql/postgresql.log

# System logs (cron, systemd)
/var/log/syslog
/var/log/systemd/

# Application logs (if using Docker)
docker logs buildingos-api           # View real-time
docker logs buildingos-api > api.log # Save to file
```

---

## 4.2 Query by Request ID

### Find Request ID in Response Headers

```bash
# Every API response includes X-Request-Id header
curl -I http://localhost:4000/health

# Output:
# HTTP/1.1 200 OK
# X-Request-Id: 550e8400-e29b-41d4-a716-446655440000  ← Copy this
```

### Query All Logs for Request ID

```bash
REQUEST_ID="550e8400-e29b-41d4-a716-446655440000"

# Find all logs with this request ID
grep "$REQUEST_ID" /var/log/buildingos/api.log

# Expected output (multiple lines, one per log entry):
# {"level":30,"time":"...","requestId":"550e8400...","msg":"POST /buildings","statusCode":201}
# {"level":30,"time":"...","requestId":"550e8400...","msg":"Building created","buildingId":"building-456"}
# {"level":30,"time":"...","requestId":"550e8400...","msg":"Response sent","durationMs":45}

# Pretty-print JSON logs
grep "$REQUEST_ID" /var/log/buildingos/api.log | jq .
```

### Example: Trace Full Request Flow

```bash
# 1. Get request ID from curl response
REQUEST_ID="550e8400-e29b-41d4-a716-446655440000"

# 2. View all steps
grep "$REQUEST_ID" /var/log/buildingos/api.log | jq '.msg, .durationMs'

# Output:
# "POST /buildings"
# "Validating JWT token"
# "Tenant validation"
# "Creating building"
# "Building created"
# "Response sent"
# 45  (milliseconds)
```

---

## 4.3 Query by Tenant ID

### Find All Activity for Specific Tenant

```bash
TENANT_ID="tenant-abc123"

# Find all logs for this tenant
grep "$TENANT_ID" /var/log/buildingos/api.log | head -50

# Expected: All requests from users in this tenant

# Count requests per tenant (audit trail)
grep "tenantId" /var/log/buildingos/api.log | jq -r '.tenantId' | sort | uniq -c | sort -rn
# Output:
# 245 tenant-abc123
#  89 tenant-xyz789
#  34 tenant-def456
```

### Example: Troubleshoot Tenant Issue

```bash
# Customer: "I can't see my buildings"
# Tenant ID: tenant-123

# 1. Find all requests from this tenant
grep "tenant-123" /var/log/buildingos/api.log | grep "buildings"

# 2. Look for errors
grep "tenant-123" /var/log/buildingos/api.log | grep -i "error\|fail"

# 3. Check specific endpoint
grep "tenant-123" /var/log/buildingos/api.log | jq 'select(.route == "GET /buildings")'

# 4. View last 10 requests from tenant
grep "tenant-123" /var/log/buildingos/api.log | tail -10
```

---

## 4.4 Query by User ID

```bash
USER_ID="user-maria456"

# Find all activity by this user
grep "$USER_ID" /var/log/buildingos/api.log

# Find errors by this user
grep "$USER_ID" /var/log/buildingos/api.log | grep -i "error"

# Find successful logins by user
grep "$USER_ID" /var/log/buildingos/api.log | grep "AUTH_LOGIN"
```

---

## 4.5 Real-Time Log Monitoring

```bash
# Follow logs in real-time (like tail -f)
tail -f /var/log/buildingos/api.log

# Filter in real-time for errors
tail -f /var/log/buildingos/api.log | grep -i "error\|fail"

# Filter for specific tenant (real-time)
tail -f /var/log/buildingos/api.log | grep "tenant-123"

# Live request rate monitor
tail -f /var/log/buildingos/api.log | grep -o '"method":"[A-Z]*"' | sort | uniq -c
```

---

## 4.6 Advanced Log Analysis

### Find Slow Queries

```bash
# Find requests taking > 1000ms (1 second)
grep "durationMs" /var/log/buildingos/api.log | jq 'select(.durationMs > 1000)' | head -20

# Expected:
# {"durationMs":1250,"route":"GET /buildings/building-456/units","msg":"Slow request"}
```

### Find Authentication Failures

```bash
# All failed logins
grep "AUTH_FAILED_LOGIN" /var/log/buildingos/api.log | head -20

# Count failures per user
grep "AUTH_FAILED_LOGIN" /var/log/buildingos/api.log | jq '.email' | sort | uniq -c
```

### Find Database Errors

```bash
# All database-related errors
grep -i "database\|connection\|query" /var/log/buildingos/api.log | grep -i "error"

# Recent database errors
tail -1000 /var/log/buildingos/api.log | grep -i "database.*error"
```

---

# PART 5: BASIC ROLLBACK

## 5.1 Rollback Strategy

### What You Can Rollback

| Component | Rollback Type | Time | Risk |
|-----------|---------------|------|------|
| **API Code** | Re-deploy previous version | 2-5 min | Low |
| **Web Code** | Re-deploy previous version | 1-3 min | Low |
| **Database** | Restore from backup | 5-15 min | Medium |
| **Configuration** | Restore .env from backup | <1 min | Low |

---

## 5.2 Rollback API to Previous Version

### Scenario: New deployment broke API

```bash
# 1. Current version has bug (e.g., buildings endpoint 500 error)

# 2. Check current deployment
kubectl get deployment buildingos-api -o jsonpath='{.spec.template.spec.containers[0].image}'
# Output: gcr.io/buildingos/api:v0.2.0 (broken)

# 3. Check previous version in your deployment history
kubectl rollout history deployment/buildingos-api
# Output:
# revision 3: v0.2.0 (current, broken)
# revision 2: v0.1.9 (previous, working)
# revision 1: v0.1.8

# 4. Rollback to previous version
kubectl rollout undo deployment/buildingos-api --to-revision=2

# Expected output:
# deployment.apps/buildingos-api rolled back to revision 2

# 5. Verify rollback
kubectl get deployment buildingos-api -o jsonpath='{.spec.template.spec.containers[0].image}'
# Output: gcr.io/buildingos/api:v0.1.9 (previous version)

# 6. Test API is working
curl http://localhost:4000/health
# Expected: {"status":"ok",...}

# 7. Notify team
# Message: "⚠️  Rolled back API v0.2.0 → v0.1.9 due to bug. Issue being investigated."
```

---

## 5.3 Rollback Web to Previous Version

```bash
# 1. Check current web deployment
kubectl get deployment buildingos-web -o jsonpath='{.spec.template.spec.containers[0].image}'

# 2. Rollback to previous version
kubectl rollout undo deployment/buildingos-web --to-revision=2

# 3. Verify rollback
kubectl get pods -l app=buildingos-web
# Expected: Pods are restarting

# 4. Wait for pods to be ready
kubectl wait --for=condition=Ready pod -l app=buildingos-web --timeout=300s

# 5. Test web is working
curl http://localhost:3000
# Expected: HTML response
```

---

## 5.4 Rollback Configuration (Secrets/Env Vars)

```bash
# 1. If .env was accidentally changed
# Find backup
ls -lh .env.backup.* | tail -3

# 2. Restore previous .env
cp .env.backup.1708694400 .env

# 3. Restart API to pick up new values
systemctl restart buildingos-api

# 4. Verify
curl http://localhost:4000/health
```

---

## 5.5 Rollback Procedure Checklist

Before rolling back:
- [ ] Issue is confirmed (not user error)
- [ ] Previous version was working (verify from logs)
- [ ] Stakeholders notified of rollback
- [ ] Backup of current version created (for forensics)

After rollback:
- [ ] All health checks pass
- [ ] Load time normal (<500ms)
- [ ] No error spikes in logs
- [ ] Customer can reproduce issue on previous version
- [ ] Root cause documented for next deployment

---

# PART 6: INCIDENT RESPONSE PLAN

## 6.1 Detection & Escalation

### Automated Monitoring (Alerting)

```bash
# If using Sentry for error tracking:
# - Alert when error rate > 1% (immediate)
# - Alert when new error type appears

# If using custom monitoring:
# - Alert when /health returns non-200 for 2+ minutes
# - Alert when response time > 2000ms for >10% requests
# - Alert when database connection fails
```

### Manual Monitoring (Daily)

```bash
# Morning checklist (daily at 08:00)
./scripts/daily-checklist.sh

# Expected: All green
# If red: Page on-call engineer immediately
```

---

## 6.2 Incident Severity Levels

| Severity | Example | Response Time | Escalation |
|----------|---------|----------------|------------|
| **P1 (Critical)** | API down, data corruption, security breach | Immediate | Wake up on-call |
| **P2 (High)** | Feature broken, 50% users affected | 15 min | Contact lead engineer |
| **P3 (Medium)** | Partial feature down, <10 users affected | 1 hour | Log ticket, email team |
| **P4 (Low)** | UI polish, non-critical bug | Next business day | Add to backlog |

---

## 6.3 P1 Incident Response (Critical)

```bash
# 1. ALERT: Page on-call engineer immediately (phone call, not Slack)

# 2. ON-CALL: Assess situation (5 minutes max)
curl http://localhost:4000/health     # Is API up?
curl http://localhost:3000            # Is Web up?
ps aux | grep buildingos              # Are processes running?
tail -50 /var/log/buildingos/api.log  # Recent errors?

# 3. Determine incident type:

# TYPE A: API Down
systemctl status buildingos-api
# If stopped: systemctl start buildingos-api
# If running but unhealthy: Check logs, restart, or rollback

# TYPE B: Database Down
psql -U buildingos -d buildingos -c "SELECT 1;"
# If fails: Check PostgreSQL service, or restore from backup

# TYPE C: Memory/Disk Full
df -h /
free -h
# If full: Clean up logs, old backups, or scale up resources

# TYPE D: Security Breach
# If suspected: Immediately isolate server, notify security team, don't touch evidence

# 4. IMMEDIATE ACTION:

# If fix is <5 min (restart service, restart pod, etc.)
# → Apply fix immediately

# If fix is >5 min (code change, migration, etc.)
# → Rollback to known-good version (see 5.2-5.4)

# 5. COMMUNICATION (immediately):
# - Slack: #incidents channel - "P1 INCIDENT: API down, investigating..."
# - Email: Notify customer (if customer-facing)
# - Status page: If you have one, update to "Investigating"

# 6. ROOT CAUSE (within 1 hour):
# grep through logs, check deployment history, review recent changes

# 7. FIX DEPLOYMENT (after root cause found):
# Deploy fix (with backup first), test thoroughly, monitor

# 8. POST-INCIDENT REVIEW (within 24 hours):
# - What happened?
# - Why did it happen?
# - How do we prevent it?
# - Update runbook if needed
```

---

## 6.4 Common Incidents & Quick Fixes

### Incident: API Crashes with OutOfMemory Error

```bash
# Quick diagnosis
dmesg | tail -10 | grep -i memory

# Quick fix (temporary)
systemctl restart buildingos-api

# Long-term fix
# Increase container memory limit or optimize code

# Monitoring
ps aux | grep buildingos-api | grep -v grep | awk '{print $6}'  # Memory usage in KB
```

### Incident: High Database Connection Errors

```bash
# Diagnosis
tail -100 /var/log/buildingos/api.log | grep -i "connection"

# Check connection pool
psql -U postgres -c "SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;"

# If pool exhausted: Check for connection leaks in code
# Short term: Restart API (kills all connections)
systemctl restart buildingos-api

# Long term: Review connection pool config, fix leaks
```

### Incident: S3/File Upload Not Working

```bash
# Test S3 access
aws s3 ls s3://buildingos-uploads/ --region us-east-1

# Check credentials
echo $S3_ACCESS_KEY
echo $S3_SECRET_KEY

# If credentials wrong: Update .env, restart API
vim .env
systemctl restart buildingos-api
```

---

# PART 7: CUSTOMER COMMUNICATION TEMPLATES

## 7.1 Incident Notification (During)

```
Subject: ⚠️ [INCIDENT] BuildingOS temporarily unavailable

Hi [Customer],

We've detected an issue with BuildingOS that's affecting service availability.
Our team is investigating immediately.

Incident start: 14:30 UTC
Current status: Investigating
Expected resolution: ~15 minutes

We'll send updates every 5 minutes.

Thank you for your patience.

- BuildingOS Support
```

## 7.2 Incident Resolution (After)

```
Subject: ✅ [RESOLVED] BuildingOS incident

Hi [Customer],

We've successfully resolved the issue that affected BuildingOS availability.

Incident duration: 14:30-14:45 UTC (15 minutes)
Root cause: Database connection pool exhausted
Resolution: Restarted API service

Affected functions: Building list, unit creation
Data loss: None - all data intact

We apologize for the disruption and will implement preventive measures.

Post-incident review planned for tomorrow.

- BuildingOS Support
```

---

# PART 8: OPERATIONAL CHECKLIST (First Customer Deployment)

**Before going live with first customer:**

- [ ] Backup scripts tested (backup-db.sh runs without error)
- [ ] Restore scripts tested on staging (restore-db.sh --env staging works)
- [ ] Manual backup created and verified (metadata file exists)
- [ ] Cron job configured for daily backups (crontab -l shows backup job)
- [ ] Secrets rotation procedure documented and tested
- [ ] Log querying tested by requestId (grep works on sample logs)
- [ ] Log querying tested by tenantId (grep works on sample logs)
- [ ] Rollback procedure tested (previous version available in deployment history)
- [ ] Incident response runbook posted where team can access
- [ ] On-call rotation defined (who responds at 2am?)
- [ ] Communication channels defined (Slack, email, SMS?)
- [ ] SLA documented and agreed with customer
- [ ] Customer has emergency contact numbers
- [ ] Database backup uploaded to S3 (off-site redundancy)
- [ ] Monitoring/alerting configured (Sentry, custom alerts, etc.)

---

**Status**: 🟢 **OPERATIONAL PROCEDURES READY**

All systems have recovery procedures. First customer deployment is prepared for any failure scenario.

