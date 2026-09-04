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
- At execution time, discover the actual production runtime SHA from the
  running API/Web OCI revision labels. Activation requires those labels to
  agree with each other and with the explicitly approved candidate SHA.
  Never infer the deployment candidate from a branch name or the current
  `main` ref; record the approved exact SHA in the activation evidence.
- GitHub Actions receives passwordless privilege only for the fixed
  `/usr/local/sbin/buildingos-production-backup-preflight` launcher. That
  root-owned launcher validates one SHA, clears caller-controlled environment
  state, and executes only root-owned control files under
  `/usr/local/libexec/buildingos-backup-preflight`; it never executes mutable
  checkout bytes as root.
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
| Privileged preflight launcher | `infra/production/launchers/buildingos-production-backup-preflight` | `/usr/local/sbin/buildingos-production-backup-preflight` |
| Privileged preflight control | `scripts/production-backup-preflight.sh` and `scripts/lib/endpoint-identity.sh` | `/usr/local/libexec/buildingos-backup-preflight/` |
| Preflight sudoers policy | `infra/production/sudoers/buildingos-production-backup-preflight` | `/etc/sudoers.d/buildingos-production-backup-preflight` |
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
| `BACKUP_WRITE` | dedicated bucket `buildingos/production/*`, `postgresql/*`, and disposable `_capability-probes/*` list/upload only |
| `VERIFY_READ` | those same dedicated prefixes list/read only, including independent HEAD of the disposable SSE probe |
| `RESTORE_WRITE` | one approved non-production restore bucket list/upload only |

`BACKUP_WRITE` also receives upload-only access to `postgresql/*`; it receives
no object-read permission. Its only other write boundary is the disposable
`_capability-probes/*` prefix. The SSE probe uploads there with `BACKUP_WRITE`
and HEADs the result with `VERIFY_READ`, proving both identities without
combining them. The probe has no delete permission and may remain under Object
Lock retention.

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

## 5A. INITIAL_INSTALL: INSTALL PRIVILEGED PREFLIGHT CONTROL

This is a **one-time approved production mutation**. It installs only the
root-owned read-only preflight control and its narrow sudoers authorization.
It does not run the preflight, deploy, execute a backup, or change systemd.

This bootstrap deliberately separates three identities:

- `CURRENT_RUNTIME_SHA` is the current application revision. For this first
  installation it remains `db82d3d37fc6184a6d4063709b9a15b923371695`; the
  active checkout must remain clean and at that exact SHA throughout.
- `CONTROL_SOURCE_SHA` is the explicit reviewed and merged 40-character commit
  that contains this launcher, sudoers template, and preflight control. It must
  be reachable from `origin/main`; never infer it from the current `main` ref.
  It may differ from `CURRENT_RUNTIME_SHA` during this bootstrap.
- `RUNTIME_CANDIDATE_SHA` is the later preflight argument. Immediately after
  this bootstrap it remains `db82d3d37fc6184a6d4063709b9a15b923371695`, not
  `CONTROL_SOURCE_SHA`.

Preconditions: approved values for all three identities are recorded, the
active checkout is clean, the source artifacts passed local review, and none of
the destination paths already exists. Updates to an existing installation
require a separate reviewed replacement procedure.

```bash
set -Eeuo pipefail
set +x

readonly app_dir='/opt/pawtech/apps/buildingos/buildingos-app'
readonly libexec_parent='/usr/local/libexec'
readonly sbin_parent='/usr/local/sbin'
readonly sudoers_parent='/etc/sudoers.d'
readonly control_dir='/usr/local/libexec/buildingos-backup-preflight'
readonly launcher='/usr/local/sbin/buildingos-production-backup-preflight'
readonly sudoers_policy='/etc/sudoers.d/buildingos-production-backup-preflight'
readonly CURRENT_RUNTIME_SHA='db82d3d37fc6184a6d4063709b9a15b923371695'
readonly CONTROL_SOURCE_SHA='<exact-reviewed-merged-control-commit>'
readonly RUNTIME_CANDIDATE_SHA="$CURRENT_RUNTIME_SHA"
source_tree=''
control_stage=''
launcher_stage='/usr/local/sbin/.buildingos-production-backup-preflight.new'
sudoers_stage='/etc/sudoers.d/buildingos-production-backup-preflight.new'
control_stage_created=false
launcher_stage_created=false
sudoers_stage_created=false
control_published=false
launcher_published=false
sudoers_published=false
activated=false

cleanup() {
  local status=$?
  local cleanup_status=0
  trap - EXIT
  set +e
  if [[ "$activated" != true ]]; then
    if [[ "$sudoers_stage_created" == true ]]; then
      sudo rm -f -- "$sudoers_stage" || cleanup_status=$?
    fi
    if [[ "$launcher_stage_created" == true ]]; then
      sudo rm -f -- "$launcher_stage" || cleanup_status=$?
    fi
    if [[ "$sudoers_published" == true ]]; then
      sudo rm -f -- "$sudoers_policy" || cleanup_status=$?
    fi
    if [[ "$launcher_published" == true ]]; then
      sudo rm -f -- "$launcher" || cleanup_status=$?
    fi
    if [[ "$control_published" == true ]]; then
      sudo rm -f -- "$control_dir/production-backup-preflight.sh" || cleanup_status=$?
      sudo rm -f -- "$control_dir/lib/endpoint-identity.sh" || cleanup_status=$?
      sudo rmdir -- "$control_dir/lib" "$control_dir" || cleanup_status=$?
    fi
    if [[ "$control_stage_created" == true && -n "$control_stage" ]]; then
      sudo rm -f -- "$control_stage/production-backup-preflight.sh" "$control_stage/lib/endpoint-identity.sh" || cleanup_status=$?
      sudo rmdir -- "$control_stage/lib" "$control_stage" || cleanup_status=$?
    fi
  fi
  if [[ -n "$source_tree" ]]; then
    git -C "$app_dir" worktree remove --force "$source_tree" || cleanup_status=$?
  fi
  if (( status == 0 && cleanup_status != 0 )); then
    printf 'ERROR: temporary preflight control cleanup failed\n' >&2
    status=$cleanup_status
  fi
  exit "$status"
}
trap cleanup EXIT

[[ "$CURRENT_RUNTIME_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$CONTROL_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$RUNTIME_CANDIDATE_SHA" == "$CURRENT_RUNTIME_SHA" ]]
active_checkout_start="$(git -C "$app_dir" rev-parse HEAD)"
[[ "$active_checkout_start" == "$CURRENT_RUNTIME_SHA" ]]
test -z "$(git -C "$app_dir" status --porcelain --untracked-files=all)"

git -C "$app_dir" fetch --no-tags origin main
git -C "$app_dir" rev-parse --verify "$CONTROL_SOURCE_SHA^{commit}" >/dev/null
git -C "$app_dir" merge-base --is-ancestor "$CONTROL_SOURCE_SHA" origin/main
source_tree="$(mktemp -d /tmp/buildingos-backup-preflight-control.XXXXXX)"
rmdir -- "$source_tree"
git -C "$app_dir" worktree add --detach "$source_tree" "$CONTROL_SOURCE_SHA"

preflight_sha="$(git -C "$app_dir" show "$CONTROL_SOURCE_SHA:scripts/production-backup-preflight.sh" | sha256sum | awk '{print $1}')"
helper_sha="$(git -C "$app_dir" show "$CONTROL_SOURCE_SHA:scripts/lib/endpoint-identity.sh" | sha256sum | awk '{print $1}')"
launcher_sha="$(git -C "$app_dir" show "$CONTROL_SOURCE_SHA:infra/production/launchers/buildingos-production-backup-preflight" | sha256sum | awk '{print $1}')"
sudoers_sha="$(git -C "$app_dir" show "$CONTROL_SOURCE_SHA:infra/production/sudoers/buildingos-production-backup-preflight" | sha256sum | awk '{print $1}')"
[[ "$preflight_sha" =~ ^[0-9a-f]{64}$ && "$helper_sha" =~ ^[0-9a-f]{64}$ && "$launcher_sha" =~ ^[0-9a-f]{64}$ && "$sudoers_sha" =~ ^[0-9a-f]{64}$ ]]
bash -n "$source_tree/scripts/production-backup-preflight.sh"
bash -n "$source_tree/scripts/lib/endpoint-identity.sh"
sh -n "$source_tree/infra/production/launchers/buildingos-production-backup-preflight"

sudo test ! -e "$control_dir" && sudo test ! -L "$control_dir"
sudo test ! -e "$launcher" && sudo test ! -L "$launcher"
sudo test ! -e "$sudoers_policy" && sudo test ! -L "$sudoers_policy"
sudo test ! -e "$launcher_stage" && sudo test ! -L "$launcher_stage"
sudo test ! -e "$sudoers_stage" && sudo test ! -L "$sudoers_stage"
sudo visudo -cf "$source_tree/infra/production/sudoers/buildingos-production-backup-preflight"

sudo install -d -o root -g root -m 0755 /usr/local/libexec
control_stage="$(sudo mktemp -d /usr/local/libexec/.buildingos-backup-preflight.XXXXXX)"
control_stage_created=true
sudo chmod 0755 "$control_stage"
sudo install -d -o root -g root -m 0755 "$control_stage/lib"
sudo install -o root -g root -m 0755 \
  "$source_tree/scripts/production-backup-preflight.sh" \
  "$control_stage/production-backup-preflight.sh"
sudo install -o root -g root -m 0644 \
  "$source_tree/scripts/lib/endpoint-identity.sh" \
  "$control_stage/lib/endpoint-identity.sh"
launcher_stage_created=true
sudo install -o root -g root -m 0755 \
  "$source_tree/infra/production/launchers/buildingos-production-backup-preflight" \
  "$launcher_stage"
sudoers_stage_created=true
sudo install -o root -g root -m 0440 \
  "$source_tree/infra/production/sudoers/buildingos-production-backup-preflight" \
  "$sudoers_stage"
sudo visudo -cf "$sudoers_stage"

test "$(sudo sha256sum "$control_stage/production-backup-preflight.sh" | awk '{print $1}')" = "$preflight_sha"
test "$(sudo sha256sum "$control_stage/lib/endpoint-identity.sh" | awk '{print $1}')" = "$helper_sha"
test "$(sudo sha256sum "$launcher_stage" | awk '{print $1}')" = "$launcher_sha"
test "$(sudo sha256sum "$sudoers_stage" | awk '{print $1}')" = "$sudoers_sha"

sudo stat -c '%U:%G %a %n' \
  "$control_stage" "$control_stage/lib" \
  "$control_stage/production-backup-preflight.sh" \
  "$control_stage/lib/endpoint-identity.sh" "$launcher_stage" "$sudoers_stage"
test "$(sudo stat -c '%u:%g:%a' "$control_stage")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$control_stage/lib")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$control_stage/production-backup-preflight.sh")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$control_stage/lib/endpoint-identity.sh")" = '0:0:644'
test "$(sudo stat -c '%u:%g:%a' "$launcher_stage")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$sudoers_stage")" = '0:0:440'

sudo mv -- "$control_stage" "$control_dir"
control_stage=''
control_stage_created=false
control_published=true
sudo mv -- "$launcher_stage" "$launcher"
launcher_stage_created=false
launcher_published=true
active_checkout_end="$(git -C "$app_dir" rev-parse HEAD)"
[[ "$active_checkout_end" == "$CURRENT_RUNTIME_SHA" ]]
test -z "$(git -C "$app_dir" status --porcelain --untracked-files=all)"
sudo mv -- "$sudoers_stage" "$sudoers_policy"
sudoers_stage_created=false
sudoers_published=true
activated=true
```

Expected metadata is `root:root`: `0755` for both directories, the preflight
script, and launcher; `0644` for the helper; and `0440` for sudoers. The policy
grants `yoryi` only `NOPASSWD:NOSETENV` access to the fixed launcher. The
launcher itself rejects zero, multiple, malformed, path, and command arguments,
verifies installed metadata, resets the environment, closes stdin, and invokes
only the installed control path. The trap removes staged or partially published
control artifacts on any failed validation; the sudoers policy is published
last, only after all validation and active-checkout revalidation pass. Each
root-owned staged file is SHA-256 checked against the exact
`CONTROL_SOURCE_SHA` Git object before publication.

Rollback under the same approved change window removes the authorization
first, validates sudoers, and then removes only these newly installed paths:

```bash
sudo rm -- "$sudoers_policy"
sudo visudo -cf /etc/sudoers
sudo rm -- "$launcher"
sudo rm -- "$control_dir/production-backup-preflight.sh"
sudo rm -- "$control_dir/lib/endpoint-identity.sh"
sudo rmdir -- "$control_dir/lib"
sudo rmdir -- "$control_dir"
```

## 5B. CONTROL_UPDATE: UPDATE INSTALLED PRIVILEGED PREFLIGHT CONTROL

`INITIAL_INSTALL` is the procedure in Section 5A and is valid only when all
three destination paths are absent. `CONTROL_UPDATE` is the procedure in this
section and is valid only when the existing installation is present and its
recorded bytes can be proven. Never choose one mode based on a failed command;
stop and inspect the installation state.

This is a separate approved production mutation from the initial installation.
**Merging repository code does not update the installed privileged control.**
GitHub Actions invokes the fixed launcher, which executes the root-owned bytes
already installed under `/usr/local/libexec`; it never executes this repository
copy as root. Do not dispatch a preflight using a new repository commit until
this replacement has been approved and completed.

For the current installation, record these three values independently:

- `INSTALLED_CONTROL_SOURCE_SHA=56b5f5d49c804dde17c194591238d6adec02c896`:
  the exact source of the currently installed root-owned bytes.
- `NEW_CONTROL_SOURCE_SHA=<reviewed-merged-commit-containing-this-update>`:
  the explicit 40-character commit to install after its PR is merged and a
  separate control-update approval is granted.
- `CURRENT_RUNTIME_SHA=db82d3d37fc6184a6d4063709b9a15b923371695`:
  the application checkout and API/Web revision that remain untouched.

The active application checkout is a read-only Git object source for this
procedure: do not switch, reset, pull, modify, or execute its scripts as root.
Fetch `origin/main`, verify both control SHAs are commits reachable from it, and
materialize `NEW_CONTROL_SOURCE_SHA` in a detached temporary worktree. The
temporary worktree is only a source for `bash -n`, `sh -n`, `visudo -cf`, and
root-owned staging; never invoke its preflight script as root.

```bash
set -Eeuo pipefail
set +x

readonly app_dir='/opt/pawtech/apps/buildingos/buildingos-app'
readonly control_dir='/usr/local/libexec/buildingos-backup-preflight'
readonly launcher='/usr/local/sbin/buildingos-production-backup-preflight'
readonly sudoers_policy='/etc/sudoers.d/buildingos-production-backup-preflight'
readonly INSTALLED_CONTROL_SOURCE_SHA='56b5f5d49c804dde17c194591238d6adec02c896'
readonly NEW_CONTROL_SOURCE_SHA='<reviewed-merged-40-character-commit>'
readonly CURRENT_RUNTIME_SHA='db82d3d37fc6184a6d4063709b9a15b923371695'
readonly rollback_control_dir="/usr/local/libexec/.buildingos-backup-preflight.rollback-$INSTALLED_CONTROL_SOURCE_SHA"
readonly launcher_rollback="/usr/local/sbin/.buildingos-production-backup-preflight.rollback-$INSTALLED_CONTROL_SOURCE_SHA"
readonly sudoers_rollback="/etc/sudoers.d/.buildingos-production-backup-preflight.rollback-$INSTALLED_CONTROL_SOURCE_SHA"
source_tree=''
control_stage=''
launcher_stage=''
sudoers_stage=''
declare -A old_hash new_hash
control_old_preserved=false
control_new_published=false
launcher_old_preserved=false
launcher_new_published=false
sudoers_old_preserved=false
sudoers_new_published=false
activation_complete=false
publication_started=false
control_new_moved_aside=false
control_new_evidence_preserved=false
recovery_required=false

readonly failed_control_dir="/usr/local/libexec/.buildingos-backup-preflight.failed-$NEW_CONTROL_SOURCE_SHA"
readonly failed_launcher="/usr/local/sbin/.buildingos-production-backup-preflight.failed-$NEW_CONTROL_SOURCE_SHA"
readonly failed_sudoers="/etc/sudoers.d/.buildingos-production-backup-preflight.failed-$NEW_CONTROL_SOURCE_SHA"

validate_privileged_parent() {
  local parent="$1"
  sudo test -d "$parent"
  sudo test ! -L "$parent"
  test "$(sudo stat -c '%u:%g:%a' "$parent")" = '0:0:755'
}

verify_control_tree() {
  local root="$1" expected_preflight_hash="$2" expected_helper_hash="$3"
  sudo test -d "$root" && sudo test ! -L "$root"
  sudo test -d "$root/lib" && sudo test ! -L "$root/lib"
  sudo test -f "$root/production-backup-preflight.sh" && sudo test ! -L "$root/production-backup-preflight.sh"
  sudo test -f "$root/lib/endpoint-identity.sh" && sudo test ! -L "$root/lib/endpoint-identity.sh"
  test "$(sudo sha256sum "$root/production-backup-preflight.sh" | awk '{print $1}')" = "$expected_preflight_hash"
  test "$(sudo sha256sum "$root/lib/endpoint-identity.sh" | awk '{print $1}')" = "$expected_helper_hash"
  test "$(sudo stat -c '%u:%g:%a' "$root")" = '0:0:755'
  test "$(sudo stat -c '%u:%g:%a' "$root/lib")" = '0:0:755'
  test "$(sudo stat -c '%u:%g:%a' "$root/production-backup-preflight.sh")" = '0:0:755'
  test "$(sudo stat -c '%u:%g:%a' "$root/lib/endpoint-identity.sh")" = '0:0:644'
}

verify_previous_installation() {
  verify_control_tree "$control_dir" "${old_hash[scripts/production-backup-preflight.sh]}" "${old_hash[scripts/lib/endpoint-identity.sh]}"
  test "$(sudo sha256sum "$launcher" | awk '{print $1}')" = "${old_hash[infra/production/launchers/buildingos-production-backup-preflight]}"
  test "$(sudo sha256sum "$sudoers_policy" | awk '{print $1}')" = "${old_hash[infra/production/sudoers/buildingos-production-backup-preflight]}"
  test "$(sudo stat -c '%u:%g:%a' "$control_dir")" = '0:0:755'
  test "$(sudo stat -c '%u:%g:%a' "$control_dir/lib")" = '0:0:755'
  test "$(sudo stat -c '%u:%g:%a' "$control_dir/production-backup-preflight.sh")" = '0:0:755'
  test "$(sudo stat -c '%u:%g:%a' "$control_dir/lib/endpoint-identity.sh")" = '0:0:644'
  test "$(sudo stat -c '%u:%g:%a' "$launcher")" = '0:0:755'
  test "$(sudo stat -c '%u:%g:%a' "$sudoers_policy")" = '0:0:440'
  sudo visudo -cf "$sudoers_policy"
  sudo visudo -cf /etc/sudoers
}

verify_new_control() {
  verify_control_tree "$control_dir" "${new_hash[scripts/production-backup-preflight.sh]}" "${new_hash[scripts/lib/endpoint-identity.sh]}"
}

rollback_update() {
  local rollback_status=0
  set +e
  if [[ "$sudoers_new_published" == true ]]; then
    sudo mv -T -- "$sudoers_policy" "$failed_sudoers" || rollback_status=$?
  fi
  if [[ "$sudoers_old_preserved" == true ]]; then
    sudo mv -T -- "$sudoers_rollback" "$sudoers_policy" || rollback_status=$?
  fi
  if [[ "$launcher_new_published" == true ]]; then
    sudo mv -T -- "$launcher" "$failed_launcher" || rollback_status=$?
  fi
  if [[ "$launcher_old_preserved" == true ]]; then
    sudo mv -T -- "$launcher_rollback" "$launcher" || rollback_status=$?
  fi
  if [[ "$control_old_preserved" == true ]]; then
    if [[ "$control_new_published" == true ]]; then
      if sudo test ! -e "$control_dir" && sudo test ! -L "$control_dir"; then
        :
      elif sudo mv -T -- "$control_dir" "$failed_control_dir" && sudo test ! -e "$control_dir" && sudo test ! -L "$control_dir"; then
        control_new_moved_aside=true
      elif verify_new_control; then
        printf 'WARNING: failed to relocate new control; validating and removing only its known files before restoration\n' >&2
        if sudo test ! -e "$failed_control_dir" && sudo test ! -L "$failed_control_dir" && sudo cp -a -T -- "$control_dir" "$failed_control_dir" && verify_control_tree "$failed_control_dir" "${new_hash[scripts/production-backup-preflight.sh]}" "${new_hash[scripts/lib/endpoint-identity.sh]}"; then
          control_new_evidence_preserved=true
        fi
        if sudo rm -f -- "$control_dir/production-backup-preflight.sh" "$control_dir/lib/endpoint-identity.sh" && sudo rmdir -- "$control_dir/lib" "$control_dir" && sudo test ! -e "$control_dir" && sudo test ! -L "$control_dir"; then
          control_new_moved_aside=true
        else
          recovery_required=true
          rollback_status=1
        fi
      else
        recovery_required=true
        rollback_status=1
      fi
    fi
    if sudo test ! -e "$control_dir" && sudo test ! -L "$control_dir"; then
      if ! sudo mv -T -- "$rollback_control_dir" "$control_dir"; then
        recovery_required=true
        rollback_status=1
      fi
    else
      recovery_required=true
      rollback_status=1
    fi
  fi
  if [[ "$publication_started" == true ]]; then
    verify_previous_installation || rollback_status=$?
  fi
  if (( rollback_status != 0 )); then
    if [[ "$recovery_required" == true ]]; then
      printf 'ERROR: CONTROL_UPDATE automatic rollback failed; RECOVERY_REQUIRED; inspect preserved rollback and failed-evidence paths\n' >&2
    else
      printf 'ERROR: CONTROL_UPDATE automatic rollback failed; inspect preserved rollback and failed-evidence paths\n' >&2
    fi
  fi
  return "$rollback_status"
}

cleanup() {
  local status=$?
  local rollback_status=0
  trap - EXIT
  set +e
  if [[ "$activation_complete" != true && "$publication_started" == true ]]; then
    rollback_update || rollback_status=$?
  fi
  if [[ -n "$control_stage" ]]; then
    sudo rm -f -- "$control_stage/production-backup-preflight.sh" "$control_stage/lib/endpoint-identity.sh"
    sudo rmdir -- "$control_stage/lib" "$control_stage"
  fi
  [[ -z "$launcher_stage" ]] || sudo rm -f -- "$launcher_stage"
  [[ -z "$sudoers_stage" ]] || sudo rm -f -- "$sudoers_stage"
  [[ -z "$source_tree" ]] || git -C "$app_dir" worktree remove --force "$source_tree"
  if (( status == 0 && rollback_status != 0 )); then
    status=$rollback_status
  fi
  exit "$status"
}
trap cleanup EXIT

[[ "$INSTALLED_CONTROL_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$NEW_CONTROL_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$(git -C "$app_dir" rev-parse HEAD)" == "$CURRENT_RUNTIME_SHA" ]]
test -z "$(git -C "$app_dir" status --porcelain --untracked-files=all)"
git -C "$app_dir" fetch --no-tags origin main
for control_sha in "$INSTALLED_CONTROL_SOURCE_SHA" "$NEW_CONTROL_SOURCE_SHA"; do
  git -C "$app_dir" rev-parse --verify "$control_sha^{commit}" >/dev/null
  git -C "$app_dir" merge-base --is-ancestor "$control_sha" origin/main
done
source_tree="$(mktemp -d /tmp/buildingos-backup-preflight-control.XXXXXX)"
rmdir -- "$source_tree"
git -C "$app_dir" worktree add --detach "$source_tree" "$NEW_CONTROL_SOURCE_SHA"

for artifact in \
  scripts/production-backup-preflight.sh \
  scripts/lib/endpoint-identity.sh \
  infra/production/launchers/buildingos-production-backup-preflight \
  infra/production/sudoers/buildingos-production-backup-preflight; do
  old_hash["$artifact"]="$(git -C "$app_dir" show "$INSTALLED_CONTROL_SOURCE_SHA:$artifact" | sha256sum | awk '{print $1}')"
  new_hash["$artifact"]="$(git -C "$app_dir" show "$NEW_CONTROL_SOURCE_SHA:$artifact" | sha256sum | awk '{print $1}')"
done
bash -n "$source_tree/scripts/production-backup-preflight.sh"
bash -n "$source_tree/scripts/lib/endpoint-identity.sh"
sh -n "$source_tree/infra/production/launchers/buildingos-production-backup-preflight"
sudo visudo -cf "$source_tree/infra/production/sudoers/buildingos-production-backup-preflight"

# Prove the live root-owned bytes are exactly the recorded installed source.
sudo test -d "$control_dir" && sudo test ! -L "$control_dir"
sudo test -d "$control_dir/lib" && sudo test ! -L "$control_dir/lib"
for installed_file in "$control_dir/production-backup-preflight.sh" "$control_dir/lib/endpoint-identity.sh" "$launcher" "$sudoers_policy"; do
  sudo test -f "$installed_file" && sudo test ! -L "$installed_file"
done
test "$(sudo sha256sum "$control_dir/production-backup-preflight.sh" | awk '{print $1}')" = "${old_hash[scripts/production-backup-preflight.sh]}"
test "$(sudo sha256sum "$control_dir/lib/endpoint-identity.sh" | awk '{print $1}')" = "${old_hash[scripts/lib/endpoint-identity.sh]}"
test "$(sudo sha256sum "$launcher" | awk '{print $1}')" = "${old_hash[infra/production/launchers/buildingos-production-backup-preflight]}"
test "$(sudo sha256sum "$sudoers_policy" | awk '{print $1}')" = "${old_hash[infra/production/sudoers/buildingos-production-backup-preflight]}"
test "$(sudo stat -c '%u:%g:%a' "$control_dir")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$control_dir/lib")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$control_dir/production-backup-preflight.sh")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$control_dir/lib/endpoint-identity.sh")" = '0:0:644'
test "$(sudo stat -c '%u:%g:%a' "$launcher")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$sudoers_policy")" = '0:0:440'
sudo visudo -cf "$sudoers_policy"
sudo test ! -e "$rollback_control_dir" && sudo test ! -L "$rollback_control_dir"
sudo test ! -e "$launcher_rollback" && sudo test ! -L "$launcher_rollback"
sudo test ! -e "$sudoers_rollback" && sudo test ! -L "$sudoers_rollback"
sudo test ! -e "$failed_control_dir" && sudo test ! -L "$failed_control_dir"
sudo test ! -e "$failed_launcher" && sudo test ! -L "$failed_launcher"
sudo test ! -e "$failed_sudoers" && sudo test ! -L "$failed_sudoers"

validate_privileged_parent "$libexec_parent"
validate_privileged_parent "$sbin_parent"
validate_privileged_parent "$sudoers_parent"

sudo test ! -e "$rollback_control_dir" && sudo test ! -L "$rollback_control_dir"
sudo test ! -e "$launcher_rollback" && sudo test ! -L "$launcher_rollback"
sudo test ! -e "$sudoers_rollback" && sudo test ! -L "$sudoers_rollback"
sudo test ! -e "$failed_control_dir" && sudo test ! -L "$failed_control_dir"
sudo test ! -e "$failed_launcher" && sudo test ! -L "$failed_launcher"
sudo test ! -e "$failed_sudoers" && sudo test ! -L "$failed_sudoers"

control_stage="$(sudo mktemp -d /usr/local/libexec/.buildingos-backup-preflight.update.XXXXXX)"
sudo chmod 0755 "$control_stage"
sudo install -d -o root -g root -m 0755 "$control_stage/lib"
sudo install -o root -g root -m 0755 "$source_tree/scripts/production-backup-preflight.sh" "$control_stage/production-backup-preflight.sh"
sudo install -o root -g root -m 0644 "$source_tree/scripts/lib/endpoint-identity.sh" "$control_stage/lib/endpoint-identity.sh"
test "$(sudo sha256sum "$control_stage/production-backup-preflight.sh" | awk '{print $1}')" = "${new_hash[scripts/production-backup-preflight.sh]}"
test "$(sudo sha256sum "$control_stage/lib/endpoint-identity.sh" | awk '{print $1}')" = "${new_hash[scripts/lib/endpoint-identity.sh]}"
test "$(sudo stat -c '%u:%g:%a' "$control_stage")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$control_stage/lib")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$control_stage/production-backup-preflight.sh")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$control_stage/lib/endpoint-identity.sh")" = '0:0:644'
```

The control directory publication uses same-filesystem renames. The short gap
between the two moves fails the launcher closed; do not dispatch a preflight in
this change window. Keep the previous directory as rollback material until all
post-publication checks pass. Publication state is explicit and the trap below
restores it automatically on any later failure:

```bash
publication_started=true
sudo mv -T -- "$control_dir" "$rollback_control_dir"
control_old_preserved=true
sudo test -d "$rollback_control_dir" && sudo test ! -L "$rollback_control_dir"
sudo test ! -e "$control_dir" && sudo test ! -L "$control_dir"
sudo mv -T -- "$control_stage" "$control_dir"
control_stage=''
control_new_published=true
sudo test -d "$control_dir" && sudo test ! -L "$control_dir"
test "$(sudo sha256sum "$control_dir/production-backup-preflight.sh" | awk '{print $1}')" = "${new_hash[scripts/production-backup-preflight.sh]}"
test "$(sudo sha256sum "$control_dir/lib/endpoint-identity.sh" | awk '{print $1}')" = "${new_hash[scripts/lib/endpoint-identity.sh]}"
```

The fixed launcher path and narrow sudoers policy normally remain byte-for-byte
unchanged. When a new expected hash equals its old expected hash, prove the
live hash and metadata above and do not overwrite it. If either expected hash
differs, that file requires explicit additional approval, separate root-owned
staging, exact hash/metadata validation, and (for sudoers) `visudo -cf` before
replacement. Publish a changed sudoers policy last, after active-checkout
revalidation. Preserve the old byte in its rollback path before moving the
validated staged replacement into place:

```bash
# Run this block only with APPROVED_LAUNCHER_REPLACEMENT=true or
# APPROVED_SUDOERS_REPLACEMENT=true recorded in the separate change approval.
if [[ "${new_hash[infra/production/launchers/buildingos-production-backup-preflight]}" != "${old_hash[infra/production/launchers/buildingos-production-backup-preflight]}" ]]; then
  [[ "${APPROVED_LAUNCHER_REPLACEMENT:-false}" == true ]]
  launcher_stage="$(sudo mktemp /usr/local/sbin/.buildingos-production-backup-preflight.update.XXXXXX)"
  sudo install -o root -g root -m 0755 "$source_tree/infra/production/launchers/buildingos-production-backup-preflight" "$launcher_stage"
  test "$(sudo sha256sum "$launcher_stage" | awk '{print $1}')" = "${new_hash[infra/production/launchers/buildingos-production-backup-preflight]}"
  test "$(sudo stat -c '%u:%g:%a' "$launcher_stage")" = '0:0:755'
  sudo install -o root -g root -m 0755 "$launcher" "$launcher_rollback"
  launcher_old_preserved=true
  test "$(sudo sha256sum "$launcher_rollback" | awk '{print $1}')" = "${old_hash[infra/production/launchers/buildingos-production-backup-preflight]}"
  test "$(sudo stat -c '%u:%g:%a' "$launcher_rollback")" = '0:0:755'
  sudo mv -T -- "$launcher_stage" "$launcher"
  launcher_stage=''
  launcher_new_published=true
fi
active_checkout_before_sudoers="$(git -C "$app_dir" rev-parse HEAD)"
[[ "$active_checkout_before_sudoers" == "$CURRENT_RUNTIME_SHA" ]]
test -z "$(git -C "$app_dir" status --porcelain --untracked-files=all)"
if [[ "${new_hash[infra/production/sudoers/buildingos-production-backup-preflight]}" != "${old_hash[infra/production/sudoers/buildingos-production-backup-preflight]}" ]]; then
  [[ "${APPROVED_SUDOERS_REPLACEMENT:-false}" == true ]]
  sudoers_stage="$(sudo mktemp /etc/sudoers.d/.buildingos-production-backup-preflight.update.XXXXXX)"
  sudo install -o root -g root -m 0440 "$source_tree/infra/production/sudoers/buildingos-production-backup-preflight" "$sudoers_stage"
  sudo visudo -cf "$sudoers_stage"
  test "$(sudo sha256sum "$sudoers_stage" | awk '{print $1}')" = "${new_hash[infra/production/sudoers/buildingos-production-backup-preflight]}"
  test "$(sudo stat -c '%u:%g:%a' "$sudoers_stage")" = '0:0:440'
  sudo install -o root -g root -m 0440 "$sudoers_policy" "$sudoers_rollback"
  sudoers_old_preserved=true
  test "$(sudo sha256sum "$sudoers_rollback" | awk '{print $1}')" = "${old_hash[infra/production/sudoers/buildingos-production-backup-preflight]}"
  test "$(sudo stat -c '%u:%g:%a' "$sudoers_rollback")" = '0:0:440'
  sudo mv -T -- "$sudoers_stage" "$sudoers_policy"
  sudoers_stage=''
  sudoers_new_published=true
fi
active_checkout_end="$(git -C "$app_dir" rev-parse HEAD)"
[[ "$active_checkout_end" == "$CURRENT_RUNTIME_SHA" ]]
test -z "$(git -C "$app_dir" status --porcelain --untracked-files=all)"
sudo visudo -cf /etc/sudoers
test "$(sudo sha256sum "$control_dir/production-backup-preflight.sh" | awk '{print $1}')" = "${new_hash[scripts/production-backup-preflight.sh]}"
test "$(sudo sha256sum "$control_dir/lib/endpoint-identity.sh" | awk '{print $1}')" = "${new_hash[scripts/lib/endpoint-identity.sh]}"
test "$(sudo stat -c '%u:%g:%a' "$control_dir")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$control_dir/lib")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$control_dir/production-backup-preflight.sh")" = '0:0:755'
test "$(sudo stat -c '%u:%g:%a' "$control_dir/lib/endpoint-identity.sh")" = '0:0:644'
test "$(sudo sha256sum "$launcher" | awk '{print $1}')" = "${new_hash[infra/production/launchers/buildingos-production-backup-preflight]}"
test "$(sudo stat -c '%u:%g:%a' "$launcher")" = '0:0:755'
test "$(sudo sha256sum "$sudoers_policy" | awk '{print $1}')" = "${new_hash[infra/production/sudoers/buildingos-production-backup-preflight]}"
test "$(sudo stat -c '%u:%g:%a' "$sudoers_policy")" = '0:0:440'
sudo visudo -cf "$sudoers_policy"
for stage in /usr/local/libexec/.buildingos-backup-preflight.update.* /usr/local/sbin/.buildingos-production-backup-preflight.update.* /etc/sudoers.d/.buildingos-production-backup-preflight.update.*; do
  sudo test ! -e "$stage" && sudo test ! -L "$stage"
done
activation_complete=true
```

Stop on any installation or validation failure. Do not fall back to granting
passwordless access to `bash`, `sh`, `env`, `systemctl`, Docker, or checkout
scripts.

## 6. PRE-DEPLOY PAIRED BACKUP READINESS

The first paired backup protects the revision that is running now. It is not a
post-deploy check for a later application candidate. Record these independent
identities before continuing:

- `CURRENT_RUNTIME_SHA`: the clean checkout SHA and matching API/Web OCI
  revision that must receive the first paired backup.
- `CONTROL_SOURCE_SHA`: the reviewed, merged SHA used only to install the
  root-owned preflight control in Section 5A.
- `LATER_DEPLOY_SHA`: the separately approved application candidate. It is not
  deployed until the first paired backup and independent verification pass.

Do not substitute `CONTROL_SOURCE_SHA` or `LATER_DEPLOY_SHA` for
`CURRENT_RUNTIME_SHA` when dispatching the preflight or starting the first
paired backup. The current runtime checkout must already contain the coordinator
and paired-backup scripts required below. If it does not, stop for a separately
reviewed recovery plan; do not deploy `LATER_DEPLOY_SHA` merely to satisfy this
readiness gate.

## 7. INSTALL BACKUP COORDINATOR FOR CURRENT RUNTIME

Preconditions: the exact clean `CURRENT_RUNTIME_SHA` is still running, and its
checkout contains the paired-backup scripts. Scripts run directly as `yoryi`
from that exact clean checkout; no production-only script is edited.

```bash
test -x /opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-buildingos-production.sh
test -x /opt/pawtech/apps/buildingos/buildingos-app/scripts/backup-postgres-paired.sh
```

Expected: scripts are executable and `bash -n` passes. There is no deployment
or runtime mutation at this stage. Stop if the current runtime does not meet
this contract.

## 8. INSTALL PAIRED BACKUP UNITS AND STATE DIRECTORY

Preconditions: Sections 5 through 7 pass under a separately approved systemd
change window. Install the units but do not enable the new timers until the
first manual paired backup and independent verification pass. Create the state
directory before execution readiness with this fail-before-mutation contract:

- **Absent path:** prove it is absent and not a symlink, create it as
  `yoryi:yoryi` `0700`, then verify exact metadata.
- **Existing path:** before `install`, `chmod`, or `chown`, prove it is a real
  non-symlink directory with exact `yoryi:yoryi` `0700` metadata. Reuse it
  without mutation only when all checks pass.
- **Any other object or unexpected metadata:** stop for separate remediation.
  Never follow a symlink or silently repair an existing directory.

```bash
state_uid="$(id -u yoryi)"
state_gid="$(id -g yoryi)"
state_dir='/var/lib/buildingos-backup'
if sudo test -e "$state_dir" || sudo test -L "$state_dir"; then
  sudo test -d "$state_dir"
  sudo test ! -L "$state_dir"
  test "$(sudo stat -c '%u:%g:%a' "$state_dir")" = "$state_uid:$state_gid:700"
else
  sudo test ! -e "$state_dir"
  sudo test ! -L "$state_dir"
  sudo install -d -o yoryi -g yoryi -m 0700 "$state_dir"
  sudo test -d "$state_dir"
  sudo test ! -L "$state_dir"
  test "$(sudo stat -c '%u:%g:%a' "$state_dir")" = "$state_uid:$state_gid:700"
fi
sudo install -o root -g root -m 0644 infra/production/systemd/*.service /etc/systemd/system/
sudo install -o root -g root -m 0644 infra/production/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/pawtech-buildingos-backup*.service /etc/systemd/system/pawtech-buildingos-backup*.timer
```

Expected: the state directory is a non-symlink `yoryi:yoryi` `0700` directory,
all units validate, and all new timers remain disabled. Rollback removes only
the newly installed unit files and the newly created empty state directory, then
runs `daemon-reload`; do not delete backup evidence.

## 9. READ-ONLY PREFLIGHT AND LEGACY OVERLAP WINDOW

The installed preflight correctly rejects an active legacy timer or a scheduled
legacy trigger. Therefore a separately approved temporary overlap-control
window is required immediately before the first paired backup. This is not an
early permanent disable.

1. Confirm `pawtech-postgres-backup.service` is inactive and the new backup
   service is not running.
2. Temporarily stop, but do not disable,
   `pawtech-postgres-backup.timer` immediately before dispatching the preflight.
3. Prove the timer is inactive and has no next trigger, then dispatch the
   read-only preflight with `CURRENT_RUNTIME_SHA`.
4. Keep the legacy timer stopped only while the preflight, first paired backup,
   and independent verification run.
5. If the preflight, paired backup, or verification fails, immediately restart
   the legacy timer and preserve all evidence. Do not enable new timers.

```bash
sudo systemctl show pawtech-postgres-backup.service -p ActiveState
sudo systemctl stop pawtech-postgres-backup.timer
test "$(systemctl is-active pawtech-postgres-backup.timer)" != active
test "$(systemctl show pawtech-postgres-backup.timer -p NextElapseUSecRealtime --value)" = n/a
# Dispatch production-backup-preflight.yml with candidate_sha=CURRENT_RUNTIME_SHA.
```

Expected: the workflow remains read-only and reports clean matching runtime
identity, protected configuration, unit contracts, state directory, and no
legacy overlap. On any failed gate, run
`sudo systemctl start pawtech-postgres-backup.timer` and stop.

## 10. FIRST PAIRED BACKUP

Preconditions: the Section 9 preflight passes for `CURRENT_RUNTIME_SHA`; the
legacy timer remains temporarily stopped; SSE proof still validates; API/Web
labels agree; and the operator has approved one manual start.

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
fails, paired PASS is absent. Restart the legacy timer, preserve immutable
evidence, and stop; never delete or overwrite the failed prefix.

## 11. VERIFY AND COMPLETE LEGACY TRANSITION

Preconditions: first paired receipt exists.

```bash
sudo systemctl start pawtech-buildingos-backup-verify.service
sudo systemctl show pawtech-buildingos-backup-verify.service -p Result -p ExecMainStatus
```

Expected: `MINIO_BACKUP_VERIFY_COMPLETE`, `STATUS=PASS`, matching
`BACKUP_SET_ID` and `APP_SHA`. On failure, restart the legacy timer, leave new
timers disabled, and stop.

Only after that success, permanently replace the legacy unpaired schedule. The
temporary stop in Section 9 is reversible protection; this is the first point
where permanent disablement is authorized. Confirm no legacy backup service is
running, disable its timer, then enable the new timers:

```bash
sudo systemctl disable --now pawtech-postgres-backup.timer
test "$(systemctl is-active pawtech-postgres-backup.service)" != activating
sudo systemctl enable --now pawtech-buildingos-backup.timer pawtech-buildingos-backup-verify.timer pawtech-buildingos-backup-freshness.timer
```

Expected: the three new timers are enabled/active and the legacy unpaired
PostgreSQL timer is disabled/inactive. Rollback re-enables
`pawtech-postgres-backup.timer` before disabling the three new timers; preserve
all receipts and backup data.

## 12. DEPLOY LATER APPROVED SHA

Preconditions: the first paired backup and independent verification both pass
for `CURRENT_RUNTIME_SHA`, green PR checks, clean remote checkout,
`LATER_DEPLOY_SHA`, and a rollback receipt. Use only the repository production
workflow. Do not deploy a branch name or current `main` implicitly.

Expected: running API/Web image IDs carry the same `LATER_DEPLOY_SHA` OCI
revision label, health checks pass, and the deployment receipt records that
SHA. Existing deploy rollback procedure applies. This deployment is deliberately
after the current runtime has valid paired-backup evidence.

## 13. REMOVE ANONYMOUS ACCESS

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

## 14. ISOLATED RESTORE REHEARSAL

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

## 15. FINAL RECEIPT

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
