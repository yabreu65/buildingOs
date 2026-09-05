# BuildingOS Production Backup Strategy

**Status:** authoritative recovery strategy after the production backup audit.

This document describes the minimum backup architecture for BuildingOS. It is
documentation only. It does not authorize a backup, restore, deployment,
systemd change, sudoers change, storage mutation, or production configuration
change.

## Recovery Layers

| Asset | Protection | Status | High-level RPO/RTO |
| --- | --- | --- | --- |
| VPS, local configuration, PostgreSQL volume, Redis volume, local runtime state | Contabo VPS Auto Backup | Enabled externally; daily, 10 copies | Host-level disaster recovery; provider restore time applies |
| PostgreSQL logical data | `pawtech-postgres-backup.service` and `.timer` | **CURRENT / ACTIVE** | Daily logical recovery; current job retains 7 local days and 30 remote days |
| Uploaded documents and receipts | External Contabo S3-compatible Object Storage, bucket `buildingos-production` | **PENDING** independent backup | Object backup RPO/RTO is undefined until the separate implementation exists |
| Application source and repository configuration | GitHub | Available for source recovery | Rebuild-based recovery; deployment and dependency installation time applies |
| Redis | Reconstructable runtime state | No dedicated backup | Data is treated as ephemeral/rebuildable |
| Local MinIO | Existing local legacy service | **LEGACY / NON-AUTHORITATIVE** | Not a recovery source for production documents |

## Current PostgreSQL Protection

The existing local systemd mechanism remains the production PostgreSQL backup
mechanism. It currently performs all of the following:

- Daily `pg_dump -Fc` logical dumps.
- SHA-256 sidecar generation.
- Read-only `pg_restore --list` validation.
- External `rclone` copies.
- Seven-day local retention.
- Thirty-day remote retention.

The current PostgreSQL mechanism must remain unchanged until a separately
approved replacement exists and has been validated. The active service and
timer are the legacy `pawtech-postgres-backup.service` and
`pawtech-postgres-backup.timer`.

## Pending Object Storage Protection

The authoritative document store is the external S3-compatible bucket
`buildingos-production` at Contabo Object Storage. PostgreSQL dumps do not
contain those objects, and a VPS snapshot does not provide independent
protection for an external bucket.

The next small implementation PR should define an independent object-storage
backup with these minimum properties:

- A destination separate from the source bucket.
- Versioning and retention enabled at the destination.
- Source deletion never propagating to the backup destination.
- Read-only verification of object count, size, and recoverability.
- Credentials scoped to the required read/write operations only.
- A separately approved schedule and recovery test.

That implementation is intentionally deferred. This PR does not add a backup
script or change storage configuration.

## Scheduling and Automation

- Local systemd may continue to own PostgreSQL backup scheduling.
- GitHub Actions must not execute production backups or restores.
- GitHub remains a source-code recovery mechanism, not a production data-plane
  scheduler.
- PostgreSQL and object-storage backup schedules should remain independent so a
  database job cannot mask an object-storage failure.
- Every production mutation requires separate explicit approval, including
  changes to systemd, sudoers, credentials, buckets, retention, or runtime
  services.

## Superseded Designs

`PRODUCTION_BACKUP_ACTIVATION.md` is retained as historical/reference material
only. Its paired PostgreSQL/MinIO activation flow and privileged
`CONTROL_UPDATE` publication mechanism are not part of the target architecture
and must not be activated under this strategy.

The repository still contains related scripts, units, policies, workflows, and
tests. They are intentionally not deleted in this documentation-only change;
their classifications are recorded in
[`PRODUCTION_BACKUP_LEGACY_INVENTORY.md`](PRODUCTION_BACKUP_LEGACY_INVENTORY.md).
