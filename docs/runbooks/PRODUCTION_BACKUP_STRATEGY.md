# BuildingOS Production Backup Strategy

**Status:** authoritative recovery strategy after the production backup audit.

This document describes the minimum backup architecture for BuildingOS. It is
documentation only. It does not authorize a backup, restore, deployment,
systemd change, sudoers change, storage mutation, or production configuration
change.

## Recovery layers

| Asset | Protection | Status | High-level RPO/RTO |
| --- | --- | --- | --- |
| VPS, local configuration, PostgreSQL volume, Redis volume, local runtime state | Contabo VPS Auto Backup | Enabled externally; daily, 10 copies | Provider restore time applies |
| PostgreSQL logical data | `pawtech-postgres-backup.service` and `.timer` | **CURRENT / ACTIVE** | Daily; 7 local days and 30 remote days |
| Uploaded documents and receipts | External Contabo S3-compatible Object Storage, bucket `buildingos-production` | Independent object-copy job exists; exact recovery-point validity is not proven in production | Unverified until an authorized recovery-point run and audit succeed |
| Application source and repository configuration | GitHub | Available for source recovery | Rebuild-based; deployment and dependency installation time applies |
| Redis | Reconstructable runtime state | No dedicated backup | Treated as ephemeral/rebuildable |
| Local MinIO | Existing local legacy service | **LEGACY / NON-AUTHORITATIVE** | Not a recovery source for production documents |

## Existing independent backup jobs

The local PostgreSQL systemd mechanism remains the production PostgreSQL backup
mechanism. It performs daily `pg_dump -Fc` dumps, SHA-256 sidecars,
`pg_restore --list` validation, external `rclone` copies, seven-day local
retention, and thirty-day remote retention. Its active units are
`pawtech-postgres-backup.service` and `pawtech-postgres-backup.timer`.

The Object Storage copy remains independently scheduled. Neither timer is a
substitute for a coherent recovery point. Freshness of each job alone does not
prove that a database point is restorable with the exact object bytes referenced
by its `File` rows. The independent timer contract remains unchanged by the
recovery-point tooling; no timer, credential, retention, or storage policy
change is authorized here.

## Recovery-point capture and selection

`OBJECT_BACKUP_01_RECOVERY_POINT_GATE` implements a local, fail-closed
pre-migration capture path. Stopping the API alone is insufficient because
valid presigned PUT URLs may remain usable for 24 hours. The gate snapshots the
exact bucket policy, applies a temporary server-side write-deny fence, and
probes its behavior. While the fence is active, it captures the shared
PostgreSQL/File MVCC point, the canonical File manifest, observed object
versions where available, exact object bytes, a PostgreSQL dump, and hashes.
The remote recovery bundle is verified before the exact original bucket policy
is restored and positively checked. The API is resumed only if it was running
before capture and policy restoration is proven. Failure paths fail closed;
policy drift or uncertainty prevents unsafe restoration or API resume.

The durable bundle includes the File manifest, content manifest, exact object
blobs, PostgreSQL dump, integrity hashes, and a schema-validated receipt. The
read-only audit follows only the fixed
`/opt/pawtech/apps/buildingos/deployments/current-successful-deployment.v1`
selector. It binds that selector to the exact consistent active runtime:
checkout SHA, API revision, and Web revision. It then validates only the
canonically referenced SUCCESS record, receipt, and bundle, including their
private paths, hashes, manifest identities, dump, and object content. It never
selects a recovery point by timestamp, recency, or directory name.

A failed deployment must not replace the prior selector. A successful deploy
publishes its selector atomically only after the SUCCESS record and active
runtime identity are verified. A successful rollback publishes a selector for
the verified rollback runtime; recovery evidence is copied only from one exact
matching prior SUCCESS record. Zero or ambiguous matching evidence stays
`NOT_EVALUATED`—there is no fallback to another receipt.

If the selector, runtime identity, record, receipt, hashes, manifests, or bundle
is missing, stale, ambiguous, malformed, or mismatched, the audit reports
`RECOVERY_POINT_VALID=NOT_EVALUATED`, fails, and keeps
`BACKUP_READINESS=INCOMPLETE`. Independent daily backup timer and object-copy
evidence remain separate checks and are never suppressed by a recovery-point
PASS.

This repository change is local tooling only. Production and staging were not
accessed or changed; production recovery-point behavior remains unverified until
a separate explicitly authorized production run and read-only audit succeed.

## Recovery-point contract

A recovery point is valid only when every component is proven:

```text
POSTGRES_BACKUP_VALID
* OBJECT_BACKUP_VALID
* DB_OBJECT_REFERENCE_RECONCILIATION_PASS
* DB_OBJECT_CONTENT_IDENTITY_PASS
= RECOVERY_POINT_VALID
```

Object-key presence alone is insufficient. Presigned PUT URLs can outlive an API
stop, and `File.checksum` is not currently a mandatory trusted server-bound
identity. The temporary write-deny fence and the exact content capture address
that risk for the capture window. If any referenced object is missing,
mismatched, or not proven byte-for-byte, the recovery point fails closed and
must not be advertised as restorable.

## Audit and readiness

`production-readonly-audit.sh` validates the runtime-bound selector and exact
recovery evidence while retaining the independent daily backup receipt and
timer checks. A recovery bundle PASS alone does not set
`BACKUP_READINESS=PASS`; every independent readiness condition must also pass.
Until an authorized production run creates a valid selector and audit evidence,
recovery status remains `NOT_EVALUATED` and readiness remains
**FAIL-CLOSED / INCOMPLETE**. No operator may bypass, suppress, or manually mark
the audit `PASS`.

## Scheduling and automation

- Local systemd continues to own PostgreSQL and independent Object Storage backup scheduling.
- GitHub Actions must not be used as a periodic backup scheduler or expose a standalone production backup execution path.
- The approved deployment workflow may invoke its validated PostgreSQL pre-deploy backup as a safety prerequisite; it does not replace the daily PostgreSQL timer.
- GitHub is a source-code recovery mechanism, not a production data-plane scheduler.
- Every production mutation—including systemd, sudoers, credentials, buckets, retention, policy, or runtime services—requires separate explicit approval.

## Superseded designs

`PRODUCTION_BACKUP_ACTIVATION.md` remains historical/reference material only.
Its paired PostgreSQL/MinIO activation flow and privileged `CONTROL_UPDATE`
publication mechanism are not part of the target architecture and must not be
activated under this strategy. Related repository assets remain classified in
[`PRODUCTION_BACKUP_LEGACY_INVENTORY.md`](PRODUCTION_BACKUP_LEGACY_INVENTORY.md).
