# BuildingOS Operations Runbook

**Version**: 1.0
**Last Updated**: Feb 18, 2026
**Status**: Production Ready

Complete operational guide for running BuildingOS in production. Covers daily procedures, emergency recovery, deployment tasks, and troubleshooting.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Daily Operations](#daily-operations)
3. [Backup & Recovery](#backup--recovery)
4. [Database Migrations](#database-migrations)
5. [Data Cleanup & Retention](#data-cleanup--retention)
6. [Monitoring & Health Checks](#monitoring--health-checks)
7. [Troubleshooting](#troubleshooting)
8. [Emergency Procedures](#emergency-procedures)
9. [Scheduled Tasks](#scheduled-tasks)
10. [Appendix](#appendix)

---

## Quick Start

### Prerequisites

- PostgreSQL client tools (`psql`, `pg_dump`, `pg_restore`)
- AWS CLI (for S3 backup upload)
- Bash 4.0+
- Access to production database credentials

### Essential Commands

```bash
# Check system health
curl http://api-server:3001/readyz

# Create backup
./scripts/backup-db.sh --upload --env production

# Restore to staging (for testing)
./scripts/restore-db.sh backups/backup_production_*.sql.gz --env staging

# Run database cleanup
./scripts/cleanup-data.sh --dry-run

# Execute migrations
cd apps/api && npm run migrate:deploy

# View recent logs by request ID
grep "550e8400-e29b-41d4-a716-446655440000" /var/log/buildingos/api.log
```

---

## Daily Operations

### Morning Checklist (5 minutes)

**Every day before business hours:**

```bash
#!/bin/bash
# daily-checklist.sh

echo "🔍 BuildingOS Daily Checklist - $(date)"
echo "=================================="

# 1. Check health endpoint
echo "1. Checking API health..."
curl -s http://api-server:3001/readyz | jq .status
if [ $? -ne 0 ]; then echo "❌ API DOWN"; exit 1; fi

# 2. Check database connectivity
echo "2. Checking database..."
psql -c "SELECT 'Database OK' as status;"
if [ $? -ne 0 ]; then echo "❌ DATABASE DOWN"; exit 1; fi

# 3. Check storage (MinIO/S3)
echo "3. Checking storage..."
aws s3 ls s3://buildingos-uploads/ > /dev/null 2>&1
if [ $? -ne 0 ]; then echo "⚠️  Storage issue"; fi

# 4. Check recent errors in Sentry
echo "4. Checking Sentry for critical errors..."
# TODO: Add Sentry API check

# 5. Check backup status
echo "5. Checking last backup..."
ls -lht backups/*.sql.gz | head -1

echo "✅ Daily checklist complete"
```

**Run this daily:**

```bash
# Add to crontab (run at 08:00 every weekday)
0 8 * * 1-5 /home/buildingos/scripts/daily-checklist.sh >> /var/log/buildingos/daily-checklist.log 2>&1
```

### Performance Monitoring

**Check database performance:**

```bash
# Connection count
psql -c "SELECT count(*) FROM pg_stat_activity;"

# Slow queries (top 10)
psql -c "SELECT query, mean_exec_time, calls
         FROM pg_stat_statements
         ORDER BY mean_exec_time DESC LIMIT 10;"

# Index usage
psql -c "SELECT schemaname, tablename, indexname, idx_scan
         FROM pg_stat_user_indexes
         ORDER BY idx_scan DESC;"
```

**Check request latency:**

```bash
# Find slow requests in logs
grep "durationMs" /var/log/buildingos/api.log | \
  awk -F'[: ]' '{print $(NF-1)}' | sort -rn | head -10
```

---

## Backup & Recovery

### Automated Backup Scheduling

**PostgreSQL backups run automatically:**

```bash
# Daily backup at 02:00 UTC (keeps 7 days)
0 2 * * * /home/buildingos/scripts/backup-db.sh --upload --env production >> /var/log/buildingos/backup-daily.log 2>&1

# Weekly backup at 02:00 UTC Sundays (keeps 4 weeks)
# (same script, backup_type determined automatically)
```

### Manual Backup

Create backup immediately:

```bash
# Backup to local storage
./scripts/backup-db.sh --env production

# Output:
# ✓ Backup created: backups/backup_production_20260218_143022.sql.gz
# ℹ Backup size: 245M
# ✓ Metadata saved: backups/metadata/backup_production_20260218_143022.sql.gz.metadata.json

# Upload to S3
./scripts/backup-db.sh --upload --env production

# Verify backup
ls -lh backups/metadata/ | head -3
cat backups/metadata/backup_production_*.metadata.json | jq '.checksum_sha256'
```

**Backup file structure:**

```
backups/
├── backup_production_20260218_143022.sql.gz    # 245M compressed dump
├── backup_production_20260218_100000.sql.gz
└── metadata/
    ├── backup_production_20260218_143022.sql.gz.metadata.json
    └── backup_production_20260218_100000.sql.gz.metadata.json

Metadata includes:
{
  "timestamp": "2026-02-18T14:30:22Z",
  "environment": "production",
  "database": "buildingos_prod",
  "size_bytes": 256000000,
  "checksum_sha256": "abc123...",
  "schema_version": "20260218215449",
  "backup_type": "daily",
  "compressed": true
}
```

### Restore to Staging (Testing)

**Restore production backup to staging to test recovery:**

```bash
# 1. Choose backup file
ls -lh backups/backup_production*.sql.gz | head -5

# 2. Restore to staging (safe default)
./scripts/restore-db.sh backups/backup_production_20260218_143022.sql.gz --env staging

# Output will:
# - Validate backup integrity ✓
# - Drop staging database
# - Recreate empty database
# - Restore all data from backup
# - Verify table counts
# - Run smoke tests

# 3. Run verification
psql -h staging-db-host -U buildingos_staging buildingos_staging -c "SELECT COUNT(*) FROM \"Building\";"

# 4. Test API with staging data
curl -H "Authorization: Bearer <token>" https://staging-api.buildingos.local/buildings

# 5. Cleanup if not needed
# (staging database resets daily/weekly)
```

### Emergency Restore (Production)

⚠️ **ONLY do this in critical data loss scenario**

```bash
# 1. Alert team
# Send alert to #incidents Slack channel

# 2. Identify restore point
ls -lh backups/metadata/ | grep production | tail -5
cat backups/metadata/backup_production_*.metadata.json | \
  jq '{timestamp, database, size_human, backup_type}' | head -20

# 3. Prepare restoration
# - Stop application (to prevent writes)
# - Notify all users of maintenance window
# - Backup current database state first!
cp backups/backup_production_latest.sql.gz \
   backups/backup_production_INCIDENT_BEFORE_$(date +%s).sql.gz

# 4. Restore
./scripts/restore-db.sh backups/backup_production_20260218_143022.sql.gz \
  --env production --force

# Output will ask for confirmation twice before proceeding

# 5. Verify restored data
psql -c "SELECT COUNT(*) FROM \"Building\", \"Unit\", \"User\";"

# 6. Restart application
systemctl restart buildingos-api

# 7. Check health
curl http://api-server:3001/readyz | jq .status

# 8. Post-mortem
# Document what happened and why
# Update monitoring to catch issues earlier
```

**Rollback procedure if restore fails:**

```bash
# If restoration fails, restore the pre-incident backup
./scripts/restore-db.sh backups/backup_production_INCIDENT_BEFORE_*.sql.gz \
  --env production --force

# Or restore from S3 if local copy corrupted
aws s3 cp s3://buildingos-backups/production/2026/02/backup_production_20260217_020000.sql.gz \
  backups/
./scripts/restore-db.sh backups/backup_production_20260217_020000.sql.gz \
  --env production --force
```

---

## Database Migrations

### Safe Migration Process

**Goal: Zero-downtime migrations in production**

### Step 1: Backup (Always)

```bash
# Create backup before any migration
./scripts/backup-db.sh --upload --env production

# Verify backup
file backups/backup_production_*.sql.gz
```

### Step 2: Prepare in Staging

```bash
# Test migration in staging environment first
cd apps/api
export DATABASE_URL="postgresql://staging_user:pass@staging-db:5432/buildingos_staging"

# Check pending migrations
npm run migrate:status
# Output shows which migrations are pending

# Run migration in staging
npm run migrate:deploy

# Verify schema changes
psql -c "\dt"  # List tables
psql -c "\d \"Building\""  # Describe table
```

### Step 3: Production Migration

**Never use `migrate dev` in production - always use `migrate deploy`**

```bash
# 1. Verify connection to prod database
cd apps/api
export DATABASE_URL="postgresql://prod_user:pass@prod-db:5432/buildingos_prod"

npm run migrate:status
# Should show: 1 pending migration(s)

# 2. Check migration SQL
cat prisma/migrations/20260218215449_migration_name/migration.sql | head -30

# 3. Run migration
npm run migrate:deploy

# Output:
#
# 1 migration was applied without errors
# Schema version: 20260218215449

# 4. Verify migration
npm run migrate:status
# Should show: All migrations are up to date

# 5. Check health endpoint
curl http://api-server:3001/readyz
# Should return {"status":"healthy",...}

# 6. Verify API is operational
curl http://api-server:3001/auth/me \
  -H "Authorization: Bearer <token>"

# 7. Watch logs for errors
tail -f /var/log/buildingos/api.log | grep -i error
```

### Step 4: Verify Post-Migration

```bash
# Health checks
curl http://api-server:3001/readyz | jq '.'
# Check that database latency is acceptable (< 5ms)

# Run Prisma studio (optional, for inspection)
npm run studio

# Monitor for 15 minutes
# - Check error rate in Sentry
# - Check response times
# - Verify all endpoints working
```

### Migration Rollback (If Issues)

**If migration causes errors, rollback immediately:**

```bash
# 1. Restore from backup taken before migration
./scripts/restore-db.sh backups/backup_production_PRE_MIGRATION.sql.gz \
  --env production --force

# 2. Restart API
systemctl restart buildingos-api

# 3. Investigate migration
cd apps/api
git log --oneline prisma/migrations/ | head -5

# 4. Fix migration code
# Edit: prisma/migrations/20260218215449_migration_name/migration.sql

# 5. Test in staging first
export DATABASE_URL="<staging>"
npm run migrate:deploy

# 6. Re-run in production when ready
export DATABASE_URL="<production>"
npm run migrate:deploy
```

### Migration Checklist

```markdown
[ ] 1. Backup created and verified
[ ] 2. Migration tested in staging
[ ] 3. Schema changes reviewed
[ ] 4. Rollback plan documented
[ ] 5. Team notified of migration window
[ ] 6. Health endpoint verified
[ ] 7. Migration executed: npm run migrate:deploy
[ ] 8. /readyz endpoint shows healthy
[ ] 9. Error rate monitored for 15 minutes
[ ] 10. Team sign-off on success
```

---

## Data Cleanup & Retention

### Automatic Cleanup Scheduling

```bash
# Run cleanup daily at 03:00 UTC
0 3 * * * /home/buildingos/scripts/cleanup-data.sh --dry-run >> /var/log/buildingos/cleanup-daily.log 2>&1

# On monthly basis (1st of month), actually delete data
0 3 1 * * /home/buildingos/scripts/cleanup-data.sh --live >> /var/log/buildingos/cleanup-monthly.log 2>&1
```

### Manual Cleanup

**Preview what will be deleted (dry-run):**

```bash
./scripts/cleanup-data.sh --dry-run --env production

# Output:
# ════════════════════════════════════════════════════════
#   DATA CLEANUP (DRY-RUN)
# ════════════════════════════════════════════════════════
#
# [RESULT] Found 12 expired invitations to delete
#   (Would delete 12 invitations)
#
# [RESULT] Found 5 old revoked invitations to delete
#   (Would delete 5 invitations)
#
# [RESULT] Found 156 old failed email logs to delete
#   (Would delete 156 email logs)

# Current database statistics:
# ℹ Invitations: 1250 (12 expired)
# ℹ Email Logs: 4500 (156 failed)
# ℹ Audit Logs: 125000 (PROTECTED - never deleted)
```

**Actually delete data:**

```bash
./scripts/cleanup-data.sh --live --env production

# After confirmation, will delete:
# ✓ 12 expired invitations
# ✓ 5 old revoked invitations
# ✓ 156 failed email logs (>30 days old)
#
# AuditLog: NEVER deleted (append-only)
```

### Retention Policy Reference

See [DATA_RETENTION.md](./DATA_RETENTION.md) for complete policy.

---

## Monitoring & Health Checks

### Health Check Endpoints

**Liveness probe** (simple check):

```bash
curl http://api-server:3001/health

# Response:
# {"status":"ok","timestamp":"2026-02-18T15:30:45.123Z"}
```

**Readiness probe** (dependencies check):

```bash
curl http://api-server:3001/readyz | jq '.'

# Healthy response:
# {
#   "status": "healthy",
#   "timestamp": "2026-02-18T15:30:45.123Z",
#   "checks": {
#     "database": {
#       "status": "up",
#       "latency": 2
#     },
#     "storage": {
#       "status": "up"
#     },
#     "email": {
#       "status": "up",
#       "provider": "smtp"
#     }
#   }
# }

# Unhealthy response (database down):
# {
#   "status": "unhealthy",
#   "checks": {
#     "database": {
#       "status": "down",
#       "error": "connect ECONNREFUSED 127.0.0.1:5432"
#     }
#   }
# }
```

### Request Tracing with RequestId

**Use requestId to trace any issue:**

```bash
# Example: Admin reports slow building creation

# 1. Get requestId from client
# Browser DevTools → Network → Response Headers → X-Request-Id
# OR: API error response has X-Request-Id header

REQUEST_ID="550e8400-e29b-41d4-a716-446655440000"

# 2. Search logs
grep "$REQUEST_ID" /var/log/buildingos/api.log

# Output shows all log entries for that request:
# {"requestId":"550e8400...","method":"POST","route":"/buildings","durationMs":12345,...}
# {"requestId":"550e8400...","message":"Building created successfully",...}

# 3. Analyze timeline
# - Request started at: timestamp
# - Database query took: X ms
# - Email send took: Y ms
# - Total duration: 12,345 ms

# 4. Identify bottleneck
# If durationMs is high, check what happened during that request

# See OBSERVABILITY.md for full guide
```

### Monitoring Alerts to Set Up

| Alert | Threshold | Action |
|-------|-----------|--------|
| API Down | Health check fails | Page oncall, restart API |
| Database Slow | latency > 100ms | Check connections, check queries |
| High Error Rate | > 10 errors/min | Check Sentry, investigate logs |
| High P99 Latency | > 2s | Check database metrics, check slow queries |
| Storage Down | health.storage = down | Restart MinIO or check S3 |

---

## Troubleshooting

### Issue: API Returns 503 Error

**Symptom**: All requests return 503 Service Unavailable

**Diagnosis**:

```bash
# 1. Check API is running
curl http://api-server:3001/health

# 2. Check readiness
curl http://api-server:3001/readyz | jq '.status'

# 3. Check logs
tail -f /var/log/buildingos/api.log | grep -i error

# 4. If readyz shows unhealthy, check individual services
curl http://api-server:3001/readyz | jq '.checks'
```

**Resolution:**

```bash
# If database is down:
# 1. Check PostgreSQL status
systemctl status postgresql

# 2. Try to connect
psql -h db-host -U buildingos_prod buildingos_prod

# 3. Restart database
systemctl restart postgresql

# 4. Restart API
systemctl restart buildingos-api

# 5. Verify recovery
curl http://api-server:3001/readyz
```

### Issue: Database Connection Slow

**Symptom**: Requests taking >1 second, /readyz shows latency > 100ms

**Diagnosis**:

```bash
# 1. Check active connections
psql -c "SELECT count(*) FROM pg_stat_activity;"

# 2. List slow queries
psql -c "SELECT query, mean_exec_time, calls
         FROM pg_stat_statements
         ORDER BY mean_exec_time DESC LIMIT 5;"

# 3. Check disk space
df -h /var/lib/postgresql

# 4. Check CPU usage
top -b -n 1 | grep postgres
```

**Resolution:**

```bash
# If max connections reached:
# 1. Check connection pool settings
cat /etc/postgresql/postgresql.conf | grep max_connections

# 2. Increase max_connections
# Edit postgresql.conf, set max_connections = 200
# Then: systemctl restart postgresql

# If slow query found:
# 1. Analyze query plan
EXPLAIN ANALYZE SELECT ...;

# 2. Add index if needed
CREATE INDEX idx_tenant_building ON "Building"("tenantId");

# 3. Re-run to verify improvement
EXPLAIN ANALYZE SELECT ...;
```

### Issue: High Disk Usage

**Symptom**: Disk usage >80%, backups failing due to space

**Diagnosis**:

```bash
# 1. Check disk usage
du -sh /var/lib/postgresql
du -sh /home/buildingos/backups

# 2. Find large objects
find /var/lib/postgresql -size +1G

# 3. Check log file sizes
du -sh /var/log/buildingos/*
```

**Resolution**:

```bash
# 1. Clean old backups
./scripts/cleanup-data.sh --live  # Cleans expired invitations, old logs

# 2. Archive old logs
gzip /var/log/buildingos/api.log.2026-01-*

# 3. If Postgres WAL growing:
# Run vacuum full
psql -c "VACUUM FULL;"

# 4. Remove old WAL files
# (if using streaming replication)
pg_archivecleanup -d /var/lib/postgresql/pg_wal 00000001000000010000003D
```

### Issue: Corrupt Backup File

**Symptom**: Restore fails, checksum mismatch

**Diagnosis**:

```bash
# 1. Check file integrity
file backups/backup_production_*.sql.gz

# 2. Check checksum
sha256sum backups/backup_production_*.sql.gz

# 3. Compare with metadata
cat backups/metadata/backup_production_*.metadata.json | jq '.checksum_sha256'

# 4. Try to decompress
gzip -t backups/backup_production_*.sql.gz
# If error: "unexpected end of file" → file is corrupted
```

**Resolution**:

```bash
# 1. Delete corrupt backup
rm backups/backup_production_CORRUPTED.sql.gz

# 2. Use previous backup
./scripts/restore-db.sh backups/backup_production_PREVIOUS.sql.gz --env staging

# 3. Re-download from S3 if available
aws s3 cp s3://buildingos-backups/production/2026/02/backup_production_*.sql.gz \
  backups/

# 4. Investigate why it corrupted
# - Check disk health: smartctl -a /dev/sda
# - Check filesystem: fsck
# - Check upload process logs
```

### Issue: Migration Fails

**Symptom**: `npm run migrate:deploy` returns error

**Diagnosis**:

```bash
# 1. Check which migrations are pending
npm run migrate:status

# 2. Check migration SQL
cat prisma/migrations/20260218215449_name/migration.sql

# 3. Try to run manually
psql < prisma/migrations/20260218215449_name/migration.sql

# 4. Check database state
psql -c "\d \"TableName\""  # Check table exists
```

**Resolution**:

```bash
# If migration syntax error:
# 1. Fix the SQL in the migration file
vim prisma/migrations/20260218215449_name/migration.sql

# 2. Mark migration as resolved
npm run migrate:resolve --name "migration name"

# 3. Re-apply
npm run migrate:deploy

# If table/column already exists:
# 1. Manually mark as applied (this is rare)
npm run migrate:skip --name "migration name"

# 2. Verify with migrate:status
npm run migrate:status
```

---

## Emergency Procedures

### Procedure: Database Failure (Complete Loss)

⚠️ **CRITICAL**: Data loss imminent. Execute immediately.

```bash
# 1. ALERT: Notify team immediately
# - Page oncall engineer
# - Create incident in PagerDuty
# - Post to #incidents on Slack

# 2. STOP APPLICATION
systemctl stop buildingos-api

# 3. ASSESS DAMAGE
# - Check database status
psql -h db-host -c "SELECT 1;" 2>&1

# - Check backup availability
ls -lh backups/backup_production*.sql.gz | head -3

# - Check S3 backups
aws s3 ls s3://buildingos-backups/production/

# 4. RESTORE FROM BACKUP
./scripts/restore-db.sh backups/backup_production_20260218_020000.sql.gz \
  --env production --force

# 5. RESTART APPLICATION
systemctl start buildingos-api

# 6. VERIFY RECOVERY
curl http://api-server:3001/readyz | jq '.status'

# 7. NOTIFY USERS
# Email users: "We experienced brief downtime. Service restored. Data current as of [timestamp]."

# 8. POST-MORTEM
# - Document what happened
# - Update monitoring to catch earlier
# - Review backup procedures
```

### Procedure: Security Breach

⚠️ **CRITICAL**: Potential unauthorized access detected

```bash
# 1. ALERT SECURITY TEAM IMMEDIATELY
# - Contact CISO
# - Isolate affected systems
# - Preserve evidence

# 2. REVOKE COMPROMISED CREDENTIALS
# - Delete all active API tokens
# - Force password reset for affected users
# - Rotate database credentials

# 3. AUDIT LOGS
# - Check AuditLog for unauthorized operations
# - Use /audit/logs endpoint with filters
curl "http://api-server:3001/audit/logs?action=USER_CREATE&createdAfter=2026-02-18T00:00:00Z"

# - Export full audit trail
psql -c "SELECT * FROM \"AuditLog\" WHERE \"createdAt\" > '2026-02-17';" > audit_export.sql

# 4. RESTORE FROM BACKUP (if needed)
# - Restore to point before breach was detected
./scripts/restore-db.sh backups/backup_production_PRE_BREACH.sql.gz \
  --env production --force

# 5. NOTIFY AFFECTED USERS
# - Email template: "We detected unauthorized access to your account..."
# - Include recommended actions
# - Offer support

# 6. FOLLOW-UP
# - Enable 2FA for all users
# - Require password change
# - Monitor for similar breaches
```

---

## Scheduled Tasks

### Cron Job Configuration

```bash
# Add these to /etc/cron.d/buildingos or crontab

# Daily operations
0 2 * * * /home/buildingos/scripts/backup-db.sh --upload --env production >> /var/log/buildingos/backup-daily.log 2>&1
0 3 * * * /home/buildingos/scripts/cleanup-data.sh --dry-run >> /var/log/buildingos/cleanup-daily.log 2>&1
0 8 * * 1-5 /home/buildingos/scripts/daily-checklist.sh >> /var/log/buildingos/daily-checklist.log 2>&1

# Weekly verification (restore backup to staging and test)
0 4 * * 0 /home/buildingos/scripts/verify-backup.sh >> /var/log/buildingos/verify-backup.log 2>&1

# Monthly actual cleanup (1st of month)
0 3 1 * * /home/buildingos/scripts/cleanup-data.sh --live >> /var/log/buildingos/cleanup-monthly.log 2>&1

# Backup retention cleanup (included in backup script)
# Already handles retention automatically
```

### Monitoring Dashboard

**Key metrics to monitor continuously:**

- API uptime (target: 99.9%)
- Response time P95 (target: <500ms)
- Response time P99 (target: <1s)
- Error rate (target: <0.1%)
- Database CPU (target: <70%)
- Storage usage (alert: >80%)
- Backup success rate (target: 100%)

---

## Appendix

### Useful Commands Reference

```bash
# Check API version
curl http://api-server:3001/health | jq '.version'

# View recent errors in Sentry
# https://sentry.io/organizations/buildingos/issues/

# Search logs by tenantId
grep "tenantId.*tenant-123" /var/log/buildingos/api.log

# Export database schema
pg_dump --schema-only buildingos_prod > schema.sql

# Count rows in tables
psql -c "SELECT tablename, COUNT(*) as count
         FROM pg_tables
         WHERE schemaname = 'public'
         GROUP BY tablename;"

# List active connections and their queries
psql -c "SELECT pid, usename, state, query
         FROM pg_stat_activity
         WHERE state IS NOT NULL
         ORDER BY query_start;"

# Monitor disk IO
iostat -x 1 10

# Check PostgreSQL query log
tail -f /var/log/postgresql/postgresql.log | grep ERROR
```

### Contact & Escalation

| Issue | Primary | Backup | Escalation |
|-------|---------|--------|-----------|
| API Down | Platform Eng | DevOps | VP Engineering |
| Database Issues | DBA | Platform Eng | CTO |
| Security Breach | Security Team | VP Engineering | CEO + Legal |
| Data Loss | Platform Eng + DBA | VP Engineering | CEO + Board |

---

**Last Updated**: February 18, 2026
**Next Review**: May 18, 2026
