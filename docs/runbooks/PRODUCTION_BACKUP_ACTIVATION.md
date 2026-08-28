# Production Backup Activation

This runbook prepares and activates paired PostgreSQL and MinIO recovery for
BuildingOS. Every command that changes production, Contabo, or systemd requires
a separately approved change window. Nothing in this repository change runs
those commands automatically.

## Security decisions

- Contabo documents bucket versioning and Object Lock support.
- Object Lock must be selected when the dedicated bucket is created; it cannot
  be added safely after data is written.
- Start with 30-day default GOVERNANCE retention. This protects the initial
  recovery window while allowing an explicitly authorized privileged operator
  to correct a provisioning mistake. Move to COMPLIANCE only after rehearsal
  and retention-cost review because COMPLIANCE cannot be shortened or bypassed.
- Every backup set uses a new prefix. Source deletion never propagates because
  backup scripts never use delete or mirror-removal operations.
- PostgreSQL and MinIO sets are written to separate prefixes in the same new
  dedicated bucket, so both inherit versioning, Object Lock, retention, and the
  mandatory SSE-S3 gate. The old `project-backups` bucket is not the paired
  activation destination.
- SSE-S3 support remains unknown until `probe-contabo-sse-s3.sh` proves an
  `AES256` metadata response on the new bucket. Real BuildingOS backup data is
  blocked unless that protected proof matches the endpoint and bucket.
- Use separate source-read, backup-write, verify-read, and non-production
  restore-write identities. None receives delete, Object Lock bypass,
  retention-shortening, or bucket-policy administration permission.
- The production application does not require anonymous `GetObject` or
  `ListBucket`. It uses presigned URLs and authenticated API streams. The public
  S3 endpoint and required CORS must remain available for presigned browser
  operations.
- Production currently runs `c987eacdfe5e9f5b3772d498bb1b4fd77859dfdc`,
  behind repository main `b1a3dd8e14cd9e98e4ac81fe52a6162680343d22`.
  Activation cannot be claimed until an approved exact SHA containing these
  artifacts is deployed and API/Web OCI revision labels agree.
- The repository did not contain the bytes of the legacy production-only
  `/opt/pawtech/backups/scripts/backup-postgres.sh`. Its v1 identity remains
  pinned for the existing deploy preflight. Activation installs the separate
  repository-managed `backup-postgres-paired.sh`; it does not silently replace
  the legacy file.

## Artifact map

| Purpose | Repository artifact | Approved production path |
| --- | --- | --- |
| Coordinator | `scripts/backup-buildingos-production.sh` | checkout `scripts/` |
| PostgreSQL paired contract | `scripts/backup-postgres-paired.sh` | checkout `scripts/` |
| APP SHA resolver | `scripts/resolve-production-app-sha.sh` | checkout `scripts/` |
| SSE probe | `scripts/probe-contabo-sse-s3.sh` | checkout `scripts/` |
| SSE gate | `scripts/validate-sse-capability.sh` | checkout `scripts/` |
| Restore-policy generator | `scripts/render-minio-restore-target-policy.sh` | checkout `scripts/` |
| Protected environment template | `infra/production/buildingos-backup.env.example` | `/etc/buildingos/buildingos-backup.env` |
| SSE proof | generated outside Git | `/etc/buildingos/contabo-sse-s3-capability.json` |
| Restore target policy | generated outside Git | `/etc/buildingos/minio-restore-target-policy.json` |
| systemd units | `infra/production/systemd/` | `/etc/systemd/system/` |
| Non-secret policy semantics | `infra/production/policies/` | Contabo Panel/API and source MinIO IAM |

## 1. PRECHECK

Preconditions:

- Approved change ID, operator, exact deploy SHA, maintenance window, and
  rollback owner are recorded.
- Local checks and PR checks are green.
- Production checkout is clean and API/Web are healthy.
- No provider or production command below has run before approval.

Read-only commands:

```bash
git -C /opt/pawtech/apps/buildingos/buildingos-app status --short
docker inspect --type container buildingos-api buildingos-web >/dev/null
/opt/pawtech/apps/buildingos/buildingos-app/scripts/resolve-production-app-sha.sh
```

Expected: clean checkout and one 40-character SHA from matching running API/Web
image labels. Stop if labels are absent or disagree. PRECHECK has no rollback.

## 2. PROVIDER PROVISION

Preconditions: approved Contabo change and an account/project identifier that
is safe to record. Do not reuse `project-backups` or any existing prefix.

Deterministic candidate name:

```text
buildingos-prod-backup-<contabo-account-id-short>
```

Bucket names are globally unique. Check availability in the Contabo Customer
Panel before approval; if occupied, append a reviewed stable account-derived
suffix and record the final name. Do not repeatedly guess names by creating
buckets.

In the Contabo Customer Panel/API, perform one idempotent ensure operation:

1. If the exact approved bucket exists, verify its account ownership and all
   controls below; do not recreate it.
2. Otherwise create it with **Object Lock enabled at creation**.
3. Require versioning `ENABLED`.
4. Configure default retention mode `GOVERNANCE`, duration `30 days`.
5. Do not configure replication, public access, anonymous access, or lifecycle
   deletion in this first activation.

Expected: one private, dedicated bucket with versioning, Object Lock, and
30-day default retention. If an existing bucket lacks Object Lock, stop and use
a new approved name. Never delete a mistaken bucket automatically; preserve it
for operator review.

## 3. CREDENTIAL PROVISION

Preconditions: dedicated bucket controls pass and the exact bucket/prefix are
recorded. The JSON files under `infra/production/policies/` define the semantic
permissions. Contabo bucket-specific restrictions must be configured through
the Customer Panel/API even if it cannot import AWS IAM JSON directly.

Create four distinct identities:

| Identity | Boundary |
| --- | --- |
| `SOURCE_READ` | production MinIO bucket list/location and object read only |
| `BACKUP_WRITE` | dedicated bucket `buildingos/production/*` list and upload only |
| `VERIFY_READ` | dedicated bucket `buildingos/production/*` and `postgresql/*` list/read only |
| `RESTORE_WRITE` | one approved non-production restore bucket list/upload only |

`BACKUP_WRITE` also receives upload-only access to `postgresql/*`; it receives
no object-read permission. The SSE probe uploads with `BACKUP_WRITE` and HEADs
the result with `VERIFY_READ`, proving both identities without combining them.

Expected: four credentials with no delete, retention, Object Lock bypass, or
policy-administration permission. Test only allowed/denied capabilities with
non-sensitive probes. On mismatch, revoke the new identity and stop; never
broaden to `*` to make a test pass.

## 4. SSE PROBE

Preconditions: new empty dedicated bucket, Object Lock/versioning/retention
verified, and an approved probe credential. The probe object contains no
BuildingOS data and may remain retained for 30 days.

Load credentials without printing them, select an evidence path outside the
checkout, then run:

```bash
umask 077
export SSE_CAPABILITY_OUTPUT="/tmp/contabo-sse-s3-capability.<change-id>.json"
/opt/pawtech/apps/buildingos/buildingos-app/scripts/probe-contabo-sse-s3.sh
```

Expected output begins `SSE_S3_SUPPORTED`, `STATUS=PASS`; the JSON evidence
must state `algorithm: AES256` and match the endpoint and bucket. Classify any
upload rejection as `SSE_S3_UNSUPPORTED`; classify missing/inconclusive stat
metadata as `SSE_S3_UNKNOWN`.

If unsupported or unknown, stop before PostgreSQL or MinIO backup. Do not set a
success flag manually. Client-side encryption must be designed and reviewed in
a separate implementation before activation. There is no rollback because the
only object is non-sensitive and protected by configured retention.

## 5. INSTALL PROTECTED CONFIG

Preconditions: SSE result is supported and all credentials are provisioned.
Create files outside the checkout without displaying values:

```bash
sudo install -d -o root -g root -m 0755 /etc/buildingos
sudo install -o root -g root -m 0600 '<prepared-backup-env>' /etc/buildingos/buildingos-backup.env
sudo install -o root -g yoryi -m 0640 "$SSE_CAPABILITY_OUTPUT" /etc/buildingos/contabo-sse-s3-capability.json
```

Generate a policy for one already approved non-production target:

```bash
policy_tmp="$(mktemp)"
/opt/pawtech/apps/buildingos/buildingos-app/scripts/render-minio-restore-target-policy.sh \
  --environment rehearsal \
  --endpoint-identity '<non-production-host:port>' \
  --bucket '<non-production-restore-bucket>' > "$policy_tmp"
jq -e 'has("production") | not' "$policy_tmp"
sudo install -o root -g root -m 0644 "$policy_tmp" /etc/buildingos/minio-restore-target-policy.json
rm -f "$policy_tmp"
```

Expected: regular non-symlink files, root-owned, mode `0600` for secrets,
`0640` for SSE evidence readable by the service group, and `0644` or stricter
for the non-secret restore policy. Production
must not appear in the policy. On failure, remove only newly installed config
files under the same approval and revoke new credentials; do not alter app env.

## 6. DEPLOY APPROVED SHA

Preconditions: normal production deploy checklist, database backup preflight,
green PR checks, clean remote checkout, approved exact SHA, and rollback
receipt. Use only the repository production workflow. Do not deploy a branch
name or current `main` implicitly.

Expected: running API/Web image IDs carry the same approved OCI revision label,
health checks pass, and the deployment receipt records that SHA. Existing
deploy rollback procedure applies. Stop before policy or timer changes if the
labels disagree.

## 7. REMOVE ANONYMOUS ACCESS

Preconditions: application audit remains valid; capture one existing document
and receipt through approved metadata-only evidence; presigned endpoint/CORS
remain configured. Follow
`docs/operations/production-minio-policy-recovery.md` exactly.

Change command after exact policy capture and checksum validation:

```bash
mc anonymous set none '<configured-production-alias>/<production-bucket>'
```

Expected:

- unauthenticated ListObjects returns `403`;
- unauthenticated GET for known document and receipt keys returns `403`;
- credentialed API access passes;
- presigned PUT/GET and protected API streams pass.

On failure, stop. Restore only the exact captured policy after separate
approval using that runbook; do not synthesize a public policy.

## 8. INSTALL BACKUP COORDINATOR

Preconditions: approved SHA is deployed and protected config validates. Scripts
run directly from the exact clean checkout; no production-only script is edited.

```bash
test -x /opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh
test -x /opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-postgres-paired.sh
```

Expected: scripts are executable and `bash -n` passes. There is no runtime
mutation at this stage. Roll back by deploying the previous approved SHA.

## 9. INSTALL SYSTEMD

Preconditions: all prior stages pass. Copy units but do not enable timers until
`systemd-analyze verify` passes against the installed files:

```bash
sudo install -o root -g root -m 0644 infra/production/systemd/*.service /etc/systemd/system/
sudo install -o root -g root -m 0644 infra/production/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/pawtech-buildingos-backup*.service /etc/systemd/system/pawtech-buildingos-backup*.timer
```

Expected: all units validate but remain disabled until the first manual paired
backup and independent verification pass. Optional alert integration uses a
protected executable hook receiving non-secret JSON on stdin.

Rollback: disable the three new timers, preserve journals/receipts, remove only
these installed unit files, and run `daemon-reload`. Do not delete backups.

## 10. FIRST PAIRED BACKUP

Preconditions: SSE proof still validates, API/Web SHA labels agree, timers are
not concurrently running, and the operator has approved one manual start.

```bash
sudo systemctl start pawtech-buildingos-backup.service
sudo systemctl show pawtech-buildingos-backup.service -p Result -p ExecMainStatus
sudo journalctl -u pawtech-buildingos-backup.service --since '<change-window-start>'
```

Expected final marker only after every phase succeeds:

```text
BUILDINGOS_PAIRED_BACKUP_COMPLETE
STATUS=PASS
BACKUP_SET_ID=<safe-id>
APP_SHA=<actual-running-sha>
```

If PostgreSQL fails, MinIO is not started. If MinIO or independent verification
fails, paired PASS is absent. Disable timers, preserve immutable evidence, and
stop; never delete or overwrite the failed prefix.

## 11. VERIFY

Preconditions: first paired receipt exists.

```bash
sudo systemctl start pawtech-buildingos-backup-verify.service
sudo systemctl show pawtech-buildingos-backup-verify.service -p Result -p ExecMainStatus
```

Expected: `MINIO_BACKUP_VERIFY_COMPLETE`, `STATUS=PASS`, matching
`BACKUP_SET_ID` and `APP_SHA`. On failure, leave new timers disabled and stop.

Only after that success, replace the legacy unpaired schedule. First confirm no
legacy backup service is running, stop its timer, then enable the new timers:

```bash
sudo systemctl disable --now pawtech-postgres-backup.timer
test "$(systemctl is-active pawtech-postgres-backup.service)" != activating
sudo systemctl enable --now pawtech-buildingos-backup.timer pawtech-buildingos-backup-verify.timer pawtech-buildingos-backup-freshness.timer
```

Expected: the three new timers are enabled/active and the legacy unpaired
PostgreSQL timer is disabled/inactive. Rollback re-enables
`pawtech-postgres-backup.timer` before disabling the three new timers; preserve
all receipts and backup data.

## 12. ISOLATED RESTORE REHEARSAL

Preconditions: approved empty non-production bucket and database, trusted
restore policy, separate restore-write credential, matching set/SHA, and
explicit confirmation. Retrieve the dump and checksum from
`postgresql/<BACKUP_SET_ID>/` with `VERIFY_READ`, verify the receipt SHA-256 and
custom archive, then run the existing
`scripts/rehearse-postgres-custom-recovery.sh` procedure against the isolated
PostgreSQL target. Only after that succeeds, use `scripts/restore-minio.sh`; it
re-hashes the same off-host PostgreSQL dump before any target object write and
rejects production and non-empty MinIO targets.

Expected: PostgreSQL rehearsal PASS plus `MINIO_RESTORE_COMPLETE`,
`STATUS=PASS`, exact object count/bytes and manifest match for the same
`BACKUP_SET_ID` and `APP_SHA`. Reconcile database file references against the
MinIO manifest, then validate representative documents, payment proofs, receipts,
quote attachments if present, and onboarding artifacts through an isolated app.
On failure, preserve the target and evidence; do not retry into the same bucket
or delete retained backup data.

## 13. FINAL RECEIPT

Activation is complete only when evidence records:

- exact deployed SHA and matching API/Web labels;
- dedicated bucket, versioning, Object Lock, 30-day GOVERNANCE retention;
- protected `SSE_S3_SUPPORTED` proof;
- four tested least-privilege identities;
- anonymous List/Get denied while authenticated/presigned access passes;
- first paired receipt and independent verification for one backup set;
- isolated restore receipt and functional validation;
- active timers, last/next run, freshness check, and failure hook test.

Never include credentials, environment-file contents, signed URLs, customer
object names, or raw bucket policies in the final receipt.
