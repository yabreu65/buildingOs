# Production Backup Legacy Inventory

This inventory records repository references to the superseded paired-backup
and privileged preflight designs, plus current production-readiness controls.
No referenced script, unit, workflow, test, or policy is removed by this
change.

## Classification

- `ACTIVE_PRODUCTION`: confirmed as the current production mechanism.
- `REPOSITORY_ONLY_UNUSED`: present in the repository but not active in the
  audited production runtime.
- `DEPLOY_DEPENDENCY`: used by deployment, preflight, or production-readiness
  validation when that flow is explicitly invoked.
- `TEST_DEPENDENCY`: used by repository tests or fixtures.
- `HISTORICAL_CANDIDATE_FOR_LATER_REMOVAL`: documentation or design material
  retained until a separately approved cleanup.

## Reference Inventory

The inventory contains 37 artifact entries.

| Path | References | Classification | Notes |
| --- | --- | --- | --- |
| `docs/runbooks/PRODUCTION_BACKUP_ACTIVATION.md` | Historical activation runbook, `pawtech-buildingos-backup.service`, `pawtech-buildingos-backup-verify.service`, `production-backup-preflight`, `backup-buildingos-production`, `backup-postgres-paired` | `HISTORICAL_CANDIDATE_FOR_LATER_REMOVAL` | Superseded by `PRODUCTION_BACKUP_STRATEGY.md`; retained for reference |
| `docs/runbooks/MINIO_BACKUP_RECOVERY.md` | Historical activation reference, `backup-postgres-paired` | `HISTORICAL_CANDIDATE_FOR_LATER_REMOVAL` | Paired MinIO recovery documentation |
| `.github/workflows/production-backup-preflight.yml` | `production-backup-preflight` | `DEPLOY_DEPENDENCY` | Manual preflight workflow; not a backup scheduler |
| `.github/workflows/production-readonly-audit.yml` | `production-readonly-audit.sh` | `DEPLOY_DEPENDENCY` | Current production-readiness workflow; backup readiness still depends on the superseded paired receipt and must migrate in `OBJECT-BACKUP-01` |
| `scripts/production-backup-preflight.sh` | `pawtech-buildingos-backup.service`, `pawtech-buildingos-backup-verify.service`, `production-backup-preflight`, `backup-buildingos-production`, `backup-postgres-paired` | `DEPLOY_DEPENDENCY` | Candidate/runtime and installed-control validation |
| `scripts/production-readonly-audit.sh` | `paired-<backup_set_id>.json`, `minio_verified=true`, `production-readonly-audit.yml` | `DEPLOY_DEPENDENCY` | Current production-readiness audit; backup readiness remains on the superseded paired-receipt contract until `OBJECT-BACKUP-01` migrates it |
| `scripts/lib/endpoint-identity.sh` | `production-backup-preflight`, MinIO/S3 runtime scripts, `endpoint-identity-parity.test.sh` | `DEPLOY_DEPENDENCY` | Shared endpoint canonicalization helper sourced by preflight; required by the explicitly invoked deployment validation flow |
| `infra/production/launchers/buildingos-production-backup-preflight` | `production-backup-preflight` | `DEPLOY_DEPENDENCY` | Privileged launcher artifact |
| `infra/production/sudoers/buildingos-production-backup-preflight` | `production-backup-preflight` | `DEPLOY_DEPENDENCY` | Narrow launcher policy artifact |
| `infra/production/systemd/pawtech-buildingos-backup.service` | `backup-buildingos-production` | `REPOSITORY_ONLY_UNUSED` | New paired coordinator unit; absent from audited production |
| `infra/production/systemd/pawtech-buildingos-backup.timer` | `pawtech-buildingos-backup.service` | `REPOSITORY_ONLY_UNUSED` | New paired timer; absent from audited production |
| `infra/production/systemd/pawtech-buildingos-backup-verify.service` | `backup-buildingos-production` | `REPOSITORY_ONLY_UNUSED` | New paired verification unit; absent from audited production |
| `infra/production/systemd/pawtech-buildingos-backup-verify.timer` | `pawtech-buildingos-backup-verify.service` | `REPOSITORY_ONLY_UNUSED` | New paired verification timer; absent from audited production |
| `scripts/backup-buildingos-production.sh` | `backup-buildingos-production`, `backup-postgres-paired` | `REPOSITORY_ONLY_UNUSED` | Paired PostgreSQL/MinIO coordinator; not deployed as current scheduler |
| `scripts/resolve-production-app-sha.sh` | `backup-buildingos-production`, `production-backup-preflight`, paired-backup tests | `REPOSITORY_ONLY_UNUSED` | Runtime dependency of the superseded paired coordinator; preflight checks its presence but current production does not invoke the coordinator |
| `scripts/backup-postgres-paired.sh` | `backup-postgres-paired` | `REPOSITORY_ONLY_UNUSED` | Repository-managed paired PostgreSQL contract; legacy production script remains active |
| `scripts/backup-minio.sh` | MinIO paired backup | `REPOSITORY_ONLY_UNUSED` | Superseded object-storage backup script |
| `scripts/verify-minio-backup.sh` | MinIO paired verification, SSE gate | `REPOSITORY_ONLY_UNUSED` | Superseded object-storage verification script |
| `scripts/restore-minio.sh` | MinIO paired restore, SSE gate | `REPOSITORY_ONLY_UNUSED` | Historical isolated restore script; never current production plan |
| `scripts/check-production-backup-freshness.sh` | Paired backup freshness | `REPOSITORY_ONLY_UNUSED` | Superseded freshness check |
| `scripts/notify-production-backup-failure.sh` | Paired backup failure notification | `REPOSITORY_ONLY_UNUSED` | Superseded systemd failure hook |
| `scripts/render-minio-restore-target-policy.sh` | MinIO restore policy | `REPOSITORY_ONLY_UNUSED` | Historical restore-policy generator |
| `scripts/probe-contabo-sse-s3.sh` | Contabo SSE-S3 capability probe | `REPOSITORY_ONLY_UNUSED` | Paired-design provider capability gate |
| `scripts/validate-sse-capability.sh` | SSE-S3 capability validation | `REPOSITORY_ONLY_UNUSED` | Paired-design validation gate |
| `scripts/tests/production-backup-preflight.test.sh` | All preflight, coordinator, unit, and artifact references | `TEST_DEPENDENCY` | Regression coverage for repository artifacts |
| `scripts/tests/production-backup-activation.test.sh` | `backup-buildingos-production`, `backup-postgres-paired` | `TEST_DEPENDENCY` | Isolated paired-backup contract tests |
| `scripts/tests/endpoint-identity-parity.test.sh` | `production-backup-preflight`, `backup-postgres-paired` | `TEST_DEPENDENCY` | Identity/reference parity tests |
| `scripts/tests/minio-paired-backup.test.sh` | MinIO backup, verification, restore, SSE probe | `TEST_DEPENDENCY` | Dedicated paired MinIO test suite |
| `infra/production/systemd/pawtech-buildingos-backup-freshness.service` | Paired freshness service | `REPOSITORY_ONLY_UNUSED` | Absent from audited production |
| `infra/production/systemd/pawtech-buildingos-backup-freshness.timer` | Paired freshness timer | `REPOSITORY_ONLY_UNUSED` | Absent from audited production |
| `infra/production/systemd/pawtech-buildingos-backup-alert@.service` | Paired failure alert hook | `REPOSITORY_ONLY_UNUSED` | Absent from audited production |
| `infra/production/buildingos-backup.env.example` | Paired backup environment template | `REPOSITORY_ONLY_UNUSED` | Template for superseded coordinator |
| `infra/production/backup-alert.env.example` | Paired alert environment template | `REPOSITORY_ONLY_UNUSED` | Template for superseded failure hook |
| `infra/production/policies/backup-write.json` | Paired backup-write policy | `REPOSITORY_ONLY_UNUSED` | Superseded object-storage write policy |
| `infra/production/policies/verify-read.json` | Paired verify-read policy | `REPOSITORY_ONLY_UNUSED` | Superseded object-storage verify policy |
| `infra/production/policies/source-read.json` | Paired source-read policy | `REPOSITORY_ONLY_UNUSED` | Superseded object-storage source policy |
| `infra/production/policies/restore-write.json` | Paired restore-write policy | `REPOSITORY_ONLY_UNUSED` | Superseded isolated-restore policy |

## Current Production Boundary

The audited production backup boundary is the legacy PostgreSQL systemd job:

- `pawtech-postgres-backup.timer`
- `pawtech-postgres-backup.service`
- `/opt/pawtech/backups/scripts/backup-postgres.sh`

Classification: `ACTIVE_PRODUCTION`.

The paired coordinator, paired systemd units, and privileged `CONTROL_UPDATE`
flow are not part of the current production backup plan. Removing them, or
changing their deployment/preflight behavior, requires a separate cleanup PR
with its own review and validation.
