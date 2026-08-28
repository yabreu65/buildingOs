# MinIO Backup and Recovery

## Scope and current state

This runbook is an executable, fail-closed procedure for later adoption. It
does not create production backups, change bucket policy, restart containers,
or restore production data. Credentials are supplied outside Git through
protected environment injection, Docker secrets, or a mode-0600 server file.
Never put credentials, signed URLs, or complete environment files in evidence.

Production currently runs a pinned `minio/minio` image with the named Docker
volume `buildingos_buildingos_miniodata`, bucket identity supplied by
`S3_BUCKET`, and anonymous access disabled by the production init service. The
repository contains no completed off-host MinIO backup or restore rehearsal.
The public health endpoint responds, while an anonymous root request is
denied. Exact object counts, bytes, versioning, object lock, encryption, and
replication remain production audit values to collect with read-only `mc`.

## Database and object consistency

| Database model/field | Bucket/key source | Tenant scope | Delete behavior | Recovery requirement |
| --- | --- | --- | --- | --- |
| `File.bucket`, `File.objectKey` | `tenant-{tenantId}/documents/{cuid...}` or `tenant-{tenantId}/payment-proofs/{cuid...}` | `File.tenantId`; key prefix | DB cascade/SetNull relations; MinIO delete is asynchronous | Restore every referenced object and verify the `File` mapping |
| `Document.fileId` | `File` row | `Document.tenantId` | Document delete cascades to File | Required for document metadata |
| `Quote.fileId` | `File` row | `Quote.tenantId` | SetNull when File is deleted | Required when quote attachment is retained |
| `Payment.proofFileId` | `File` row | `Payment.tenantId` | SetNull when File is deleted | Required for payment proof |
| `Payment.receiptDocumentId` | `Document` then `File` | `Payment.tenantId` | Payment-linked documents are protected from mutation | Required for approved receipt history |
| `ImportJob.originalObjectKey`, `normalizedObjectKey` | deterministic `onboarding-imports/{tenantId}/{importId}/...` | `ImportJob.tenantId` | Job lifecycle cleanup is separate | Required if import audit/replay is in scope |

The model is `DB_MINIO_CONSISTENCY_MODEL=PARTIAL`. The database transaction
does not include the object upload; an upload can remain orphaned when DB
creation fails, and a DB row can outlive an object after asynchronous cleanup,
manual deletion, or storage loss. Keys are tenant-prefixed, normalized, and
not directly user-controlled, but are generated and stored in PostgreSQL, so
they are not derivable from all other metadata. No MinIO versioning or object
lock is configured by the repository compose files.

## Recommended backup design

Use `mc mirror --overwrite` from the source bucket to a separate off-host
S3-compatible backup bucket, with no `--remove`. This protects against source
deletions propagating to the backup, but is not itself append-only or
immutable: `--overwrite` can replace an existing destination key if a backup
prefix is reused. The backup prefix is
`buildingos/<source-environment>/<backup-set-id>/`. Each set contains objects,
`meta/minio-manifest.json`, its SHA-256 file, and `backup-receipt.json`.

`BACKUP_PREFIX` is optional. When supplied, it must be a safe relative
slash-separated prefix using only letters, numbers, `.`, `_`, and `-`; empty
segments and `.`/`..` segments are rejected. Verify and restore compare the
requested `BACKUP_SET_ID` exactly with `backup-receipt.json.backup_set_id` and
fail closed on mismatch.

The destination must be a different endpoint or bucket and should provide
server-side encryption, object lock/retention, and a separate restricted
backup credential. If the selected destination cannot provide those controls,
put client-side encryption (for example an externally managed `rclone crypt`)
in front of it in a later operations change. This slice does not introduce a
new secret-management platform.

The non-destructive copy is intentional: source deletion never propagates to
existing backup sets. A new uniquely identified set is created for every run,
and a reused `BACKUP_SET_ID` fails closed. True immutability requires
destination versioning, Object Lock, and retention controls. The scripts
compare object keys, sizes, ETags where supplied by the client, counts, byte
totals, and manifest SHA-256.

### Required paired evidence

The backup receipt binds:

`BACKUP_SET_ID`, start/completion timestamps, source environment/host/bucket,
`APP_SHA`, PostgreSQL backup ID, PostgreSQL SHA-256, PostgreSQL completion
timestamp, MinIO manifest name/SHA-256, object count, byte total, and the
explicit `deletion_propagation=false` guard.

The current PostgreSQL script can upload a dump and metadata to S3, but it
does not yet emit this shared backup-set contract. A later production change
must make the PostgreSQL job create or accept the same `BACKUP_SET_ID` and
publish its receipt before the MinIO receipt is finalized. Until then, the
MinIO script requires PostgreSQL evidence as input and cannot invent it.

## Usage

All commands below use placeholders and must be supplied by a protected
secret injector. Values are not printed by the scripts.

```bash
export SOURCE_ENVIRONMENT=production
export EXPECTED_SOURCE_ENVIRONMENT=production
export SOURCE_ENDPOINT='https://<internal-minio-endpoint>'
export SOURCE_ACCESS_KEY='<read-only-backup-key>'
export SOURCE_SECRET_KEY='<secret-from-secret-store>'
export SOURCE_BUCKET='buildingos-prod'
export BACKUP_ENDPOINT='https://<off-host-s3-endpoint>'
export BACKUP_ACCESS_KEY='<backup-write-key>'
export BACKUP_SECRET_KEY='<secret-from-secret-store>'
export BACKUP_BUCKET='buildingos-backups'
export BACKUP_SET_ID='20260827t120000z-prod-<short-id>'
export APP_SHA='<40-character-deployed-sha>'
export POSTGRES_BACKUP_ID='<postgres-backup-id>'
export POSTGRES_BACKUP_SHA256='<64-character-sha256>'
export POSTGRES_BACKUP_COMPLETED_AT='<postgres-completion-time>'
scripts/backup-minio.sh
```

Verify a set independently:

```bash
export EXPECTED_SOURCE_ENVIRONMENT=production
scripts/verify-minio-backup.sh
```

Restore only to a new, empty, non-production bucket. Production is rejected
by the target-environment allowlist; there is no production override flag.

```bash
export TARGET_ENVIRONMENT=rehearsal
export TARGET_ENDPOINT='http://127.0.0.1:9000'
export TARGET_ACCESS_KEY='<rehearsal-key>'
export TARGET_SECRET_KEY='<rehearsal-secret>'
export TARGET_BUCKET='buildingos-restore-<unique-id>'
export RESTORE_CONFIRMATION='RESTORE TO NON-PRODUCTION'
scripts/restore-minio.sh
```

## Read-only production audit

Use an ephemeral `MC_CONFIG_DIR` outside all checkouts. Configure an alias
only in that temporary directory, then run read-only `mc admin info`, `mc stat`,
`mc ls --recursive --summarize`, `mc version info`, `mc ilm rule list`, and
`mc encrypt info` as permitted by the operator credential. Record aggregate
counts and bytes, MinIO image digest, volume name, bucket identity, versioning,
object lock, encryption, lifecycle, replication, and destination status. Do
not list object names unnecessarily. The public health endpoint is not proof
of backup coverage.

## Failure modes and controls

| Failure | Impact | Current protection/gap | Recommended control |
| --- | --- | --- | --- |
| VPS disk loss / volume corruption | All local objects unavailable | Persistent volume only | Daily off-host immutable sets and restore rehearsal |
| Accidental deletion | Documents disappear | Async cleanup can leave ambiguity | Append-only sets, object lock, no delete propagation |
| Ransomware/host compromise | Local and mounted credentials/backups exposed | Same-host persistence | Separate endpoint/account, encryption, isolated credentials |
| Credential compromise | Unauthorized read/write/delete | Root credentials currently used by app/MinIO | Least-privilege read and write identities, rotation plan |
| PostgreSQL restored without MinIO | Metadata points to missing objects | No paired set contract | Shared backup receipt and manifest |
| Different DB/MinIO points in time | Missing/new object mismatch | No atomic cross-system snapshot | Bounded window, timestamps, reconciliation report |
| Partial/interrupted/corrupt copy | Incomplete recovery | No existing evidence | Manifest, checksum, count/bytes, independent verification |
| Destination unavailable | RPO breach | No off-host job | Alert on failed receipt and retention monitoring |
| Wrong environment/bucket | Cross-environment contamination | Manual configuration risk | Endpoint, environment, bucket, and set identity guards |
| Interrupted upload during backup | Orphan object or absent DB row | Upload and DB are separate | Reconciliation report; retain backup objects until policy expiry |

## Recovery procedure

1. Freeze application writes if the incident plan requires a point-in-time recovery.
2. Select a PostgreSQL dump and MinIO set with matching receipt, SHA-256,
   `APP_SHA`, and completion timestamps.
3. Verify the MinIO set independently.
4. Restore PostgreSQL into an isolated temporary database using the existing
   PostgreSQL recovery procedure.
5. Restore MinIO into a new empty non-production bucket using this runbook.
6. Run a reconciliation query over `File` and import-key fields against the
   restored manifest. Report missing rows, missing objects, and orphans; do
   not delete automatically.
7. Validate representative documents, payment proofs, receipts, and import
   artifacts through the application.
8. Only a separately approved production recovery plan may switch application
   configuration to restored infrastructure.

An atomic snapshot across PostgreSQL and MinIO is not possible with the
current architecture. The practical target is a bounded consistency window:
PostgreSQL backup completion must be recorded before MinIO copy begins, or
the application must be quiesced for both operations. A future version could
add a write fence and shared backup coordinator, but that is not implemented
here.

## RPO, RTO, and retention

- Recommended MinIO RPO: 24 hours initially; reduce to 6 hours if document
  volume and operational needs justify four daily runs.
- Recommended MinIO RTO: 4 hours for a verified isolated restore and recovery
  handoff, excluding provider provisioning.
- Retention: 14 daily sets, 8 weekly sets, and 12 monthly sets; destination
  object lock should outlive the deletion-recovery window.
- Rehearsal: monthly isolated restore, plus an annual full disaster-recovery
  exercise. Monitor receipt age and verification failures.

## Production adoption still required

- Provision a separate off-host S3-compatible bucket with encryption and
  immutable retention.
- Create separate least-privilege backup-read/source and backup-write/
  restore-write credentials through the existing protected secret mechanism.
- Integrate `BACKUP_SET_ID` and PostgreSQL receipt creation into the scheduled
  backup job.
- Add a scheduler/alert for `backup-minio.sh` and
  `verify-minio-backup.sh`; no compose change is included in this slice.
- Perform a separately approved read-only MinIO inventory and then a
  non-production restore rehearsal using production-shaped metadata.
