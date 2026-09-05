# Production Backup Legacy Inventory

This inventory records repository references to the superseded paired-backup
and privileged preflight designs. No referenced script, unit, workflow, test,
or policy is removed by this change.

## Classification

- `ACTIVE_PRODUCTION`: confirmed as the current production mechanism.
- `REPOSITORY_ONLY_UNUSED`: present in the repository but not active in the
  audited production runtime.
- `DEPLOY_DEPENDENCY`: used by deployment or preflight validation when that
  flow is explicitly invoked.
- `TEST_DEPENDENCY`: used by repository tests or fixtures.
- `HISTORICAL_CANDIDATE_FOR_LATER_REMOVAL`: documentation or design material
  retained until a separately approved cleanup.

## Reference Inventory

| Path | References | Classification | Notes |
| --- | --- | --- | --- |
| `docs/runbooks/PRODUCTION_BACKUP_ACTIVATION.md` | Historical activation runbook, `pawtech-buildingos-backup.service`, `pawtech-buildingos-backup-verify.service`, `production-backup-preflight`, `backup-buildingos-production`, `backup-postgres-paired` | `HISTORICAL_CANDIDATE_FOR_LATER_REMOVAL` | Superseded by `PRODUCTION_BACKUP_STRATEGY.md`; retained for reference |
| `docs/runbooks/MINIO_BACKUP_RECOVERY.md` | Historical activation reference, `backup-postgres-paired` | `HISTORICAL_CANDIDATE_FOR_LATER_REMOVAL` | Paired MinIO recovery documentation |
| `.github/workflows/production-backup-preflight.yml` | `production-backup-preflight` | `DEPLOY_DEPENDENCY` | Manual preflight workflow; not a backup scheduler |
| `scripts/production-backup-preflight.sh` | `pawtech-buildingos-backup.service`, `pawtech-buildingos-backup-verify.service`, `production-backup-preflight`, `backup-buildingos-production`, `backup-postgres-paired` | `DEPLOY_DEPENDENCY` | Candidate/runtime and installed-control validation |
| `infra/production/launchers/buildingos-production-backup-preflight` | `production-backup-preflight` | `DEPLOY_DEPENDENCY` | Privileged launcher artifact |
| `infra/production/sudoers/buildingos-production-backup-preflight` | `production-backup-preflight` | `DEPLOY_DEPENDENCY` | Narrow launcher policy artifact |
| `infra/production/systemd/pawtech-buildingos-backup.service` | `backup-buildingos-production` | `REPOSITORY_ONLY_UNUSED` | New paired coordinator unit; absent from audited production |
| `infra/production/systemd/pawtech-buildingos-backup.timer` | `pawtech-buildingos-backup.service` | `REPOSITORY_ONLY_UNUSED` | New paired timer; absent from audited production |
| `infra/production/systemd/pawtech-buildingos-backup-verify.service` | `backup-buildingos-production` | `REPOSITORY_ONLY_UNUSED` | New paired verification unit; absent from audited production |
| `infra/production/systemd/pawtech-buildingos-backup-verify.timer` | `pawtech-buildingos-backup-verify.service` | `REPOSITORY_ONLY_UNUSED` | New paired verification timer; absent from audited production |
| `scripts/backup-buildingos-production.sh` | `backup-buildingos-production`, `backup-postgres-paired` | `REPOSITORY_ONLY_UNUSED` | Paired PostgreSQL/MinIO coordinator; not deployed as current scheduler |
| `scripts/backup-postgres-paired.sh` | `backup-postgres-paired` | `REPOSITORY_ONLY_UNUSED` | Repository-managed paired PostgreSQL contract; legacy production script remains active |
| `scripts/tests/production-backup-preflight.test.sh` | All preflight, coordinator, unit, and artifact references | `TEST_DEPENDENCY` | Regression coverage for repository artifacts |
| `scripts/tests/production-backup-activation.test.sh` | `backup-buildingos-production`, `backup-postgres-paired` | `TEST_DEPENDENCY` | Isolated paired-backup contract tests |
| `scripts/tests/endpoint-identity-parity.test.sh` | `production-backup-preflight`, `backup-postgres-paired` | `TEST_DEPENDENCY` | Identity/reference parity tests |

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
