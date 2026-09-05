# SUPERSEDED FOR CURRENT PRODUCTION USE: MinIO Backup and Recovery

> **HISTORICAL/REFERENCE MATERIAL ONLY.** This document describes the old
> paired MinIO backup design and is not the current production backup plan.
> Do not activate its paired PostgreSQL/MinIO coordinator under the current
> strategy. The authoritative plan is
> [`PRODUCTION_BACKUP_STRATEGY.md`](PRODUCTION_BACKUP_STRATEGY.md).
>
> Any future Object Storage backup implementation will be introduced
> separately. Every actual restore still requires a separately reviewed and
> approved recovery procedure.

## Scope and current state

This historical runbook describes an executable, fail-closed recovery
procedure for the superseded design. It does not create production backups,
change bucket policy, restart containers, or restore production data.
Credentials are supplied outside Git through
protected environment injection, Docker secrets, or a mode-0600 server file.
Never put credentials, signed URLs, or complete environment files in evidence.

The 2026-08-28 production audit recorded a pinned `minio/minio` image, the
named Docker volume `buildingos_buildingos_miniodata`, and bucket identity
supplied by `S3_BUCKET`. The production initializer then intended to disable
anonymous access, but that audit found anonymous `GetObject` and `ListBucket`
permissions still active. The application audit found no dependency on either
permission. The audit also recorded that the repository had no completed
off-host MinIO backup or restore rehearsal, that the public health endpoint
responded while an anonymous root request was denied, and that exact object
counts, bytes, versioning, object lock, encryption, and replication remained
values to collect with read-only `mc`.

That paragraph is historical audit context, not a current production storage
authority or an instruction to use the superseded activation procedure. The
current authoritative production document store is the external Contabo
Object Storage bucket `buildingos-production`, as defined in
[`PRODUCTION_BACKUP_STRATEGY.md`](PRODUCTION_BACKUP_STRATEGY.md). Local MinIO
is legacy and non-authoritative for production documents. Any current removal
of local MinIO, anonymous-access policy change, routing change, or
storage-policy change requires a separately reviewed and approved procedure.

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
calculate and compare per-object SHA-256 content digests, object keys, byte
sizes, counts, byte totals, and the manifest SHA-256. Verify and restore also
bind the verified manifest SHA-256, count, and byte total to the backup receipt.
Independent verification passes only when those content checks and receipt
bindings pass and every retained PostgreSQL dump, checksum, receipt, MinIO data
object, manifest, manifest checksum, and embedded receipt independently proves
`x-amz-server-side-encryption: AES256` metadata. The capability probe remains a
prerequisite; provider defaults are not treated as object-level proof.
ETags are not used as the portable cryptographic integrity control because
their semantics vary by provider, multipart upload, and encryption mode.

### Required paired evidence

The backup receipt binds:

`BACKUP_SET_ID`, start/completion timestamps, source environment/host/bucket,
`APP_SHA`, PostgreSQL backup ID, PostgreSQL SHA-256, PostgreSQL completion
timestamp, MinIO manifest name/SHA-256, object count, byte total, and the
explicit `deletion_propagation=false` guard.

`scripts/backup-postgres-paired.sh` is the repository-managed PostgreSQL
contract used by the activation coordinator. It accepts or receives the same
`BACKUP_SET_ID`, records the deployed `APP_SHA`, proves the local and remote
dump SHA-256, requires SSE-S3, uploads into `postgresql/<backup-set-id>/` in
the same versioned/Object-Locked dedicated bucket, publishes an exact PASS
receipt, and only then permits MinIO backup.
The older production-only script remains pinned for the pre-activation deploy
contract and is not silently replaced by this repository change.

## Usage

All commands below use placeholders and must be supplied by a protected
secret injector. Values are not printed by the scripts.

```bash
export SOURCE_ENVIRONMENT=production
export EXPECTED_SOURCE_ENVIRONMENT=production
export SOURCE_ENDPOINT='https://<internal-minio-endpoint>'
export SOURCE_ACCESS_KEY='<read-only-backup-key>'
export SOURCE_SECRET_KEY='<secret-from-secret-store>'
export SOURCE_BUCKET='buildingos-production'
export BACKUP_ENDPOINT='https://<off-host-s3-endpoint>'
export BACKUP_ACCESS_KEY='<backup-write-key>'
export BACKUP_SECRET_KEY='<secret-from-secret-store>'
export BACKUP_BUCKET='buildingos-backups'
export BACKUP_SET_ID='20260827t120000z-prod-<short-id>'
export APP_SHA='<40-character-deployed-sha>'
export POSTGRES_BACKUP_RECEIPT_FILE='<absolute-path-to-protected-pass-receipt>'
export BACKUP_SSE_CAPABILITY_FILE='/etc/buildingos/contabo-sse-s3-capability.json'
scripts/backup-minio.sh
```

Verify a set independently:

```bash
export EXPECTED_SOURCE_ENVIRONMENT=production
export EXPECTED_APP_SHA='<40-character-deployed-sha>'
scripts/verify-minio-backup.sh
```

Restore only to a new, empty, non-production bucket. Production is rejected
by the target-environment allowlist; there is no production override flag.

```bash
export TARGET_ENVIRONMENT=rehearsal
export EXPECTED_APP_SHA='<40-character-deployed-sha>'
export TARGET_ENDPOINT='http://127.0.0.1:19000'
export TARGET_ACCESS_KEY='<rehearsal-key>'
export TARGET_SECRET_KEY='<rehearsal-secret>'
export TARGET_BUCKET='buildingos-restore-rehearsal'
export RESTORE_CONFIRMATION='RESTORE TO NON-PRODUCTION'
scripts/restore-minio.sh
```

Normal operational restores always load the non-secret allowlist from the
fixed path `/etc/buildingos/minio-restore-target-policy.json`; the restore
caller cannot select another operational policy. The file must be a regular,
non-symlink, root-owned file that is not group or world writable. It must be
provisioned separately through protected operational configuration, not
created dynamically by the restore invocation. This slice does not provision
that file.

The policy binds each allowed non-production environment to a canonical
endpoint identity and exact restore bucket. Only `development`, `rehearsal`,
and `test` keys are accepted, and production must never appear. For example:

```json
{
  "rehearsal": {
    "endpoint_identity": "127.0.0.1:19000",
    "bucket": "buildingos-restore-rehearsal"
  }
}
```

For isolated local rehearsal only, tests may set
`MINIO_RESTORE_TEST_MODE=LOCAL_ISOLATED_ONLY` and
`MINIO_RESTORE_TEST_POLICY_FILE` to a caller-owned, non-writable test policy.
That mode accepts only `rehearsal` or `test` targets and loopback/local Docker
host identities (`localhost`, `127.0.0.1`, `::1`, or
`host.docker.internal`) over plain HTTP, plus a dedicated
`buildingos-test-restore-*` bucket. It cannot authorize a remote endpoint or
production-shaped bucket. `RESTORE_TARGET_POLICY_FILE` is not supported in any
mode.

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

## Production activation controls

The repository-managed coordinator, schedulers, failure hooks, policy
templates, and provider gate belong to the superseded paired design and must
not be activated under the current strategy. Direct operators to
`PRODUCTION_BACKUP_STRATEGY.md` for the current production plan. No actual
restore may proceed without a separately reviewed and approved recovery
procedure.
