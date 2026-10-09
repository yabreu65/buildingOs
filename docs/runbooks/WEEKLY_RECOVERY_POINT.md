# Weekly Recovery Point

This runbook describes the local preparation for a weekly Recovery Point
capture. It does not authorize a real capture, timer activation, S3 access, or
production changes.

## Design

- The official capture and S3 write-fence libraries are reused; the weekly
  runner writes to the separate `weekly-recovery-points/` namespace.
- Deploy, rollback, paired daily backup, object backup, and weekly capture use
  the same non-blocking `flock` lock. A missing lock directory or a held lock
  fails closed.
- The proposed schedule is Sunday at 03:30 UTC, after the daily backup and
  before the verification window. `Persistent=false` avoids an unattended
  catch-up capture after a host restart.
- Retention is currently a dry-run only. It validates receipts and lists
  objects older than the last four valid weekly points; it never deletes.
- Deploy-generated Recovery Points remain in their existing namespace and are
  never retention candidates.
- The protected Object Storage backup installation now ships the same lock
  helper beside its executable and verifies the helper checksum at startup;
  this prevents the installed service from silently bypassing coordination.
- Before the fence is applied, the weekly runner atomically records the pinned
  runtime identity, operation ID, state directory, and API state. The recovery
  service scans only `FENCE_PREPARED` records and delegates restoration to the
  existing `s3_fence_restore_policy` function. It never restores a policy when
  the current policy is neither the original snapshot nor this operation's
  exact fence.

## Activation prerequisites

The versioned installation is prepared with
`scripts/install-weekly-recovery-point.sh`. It copies only files from a clean
Git commit into `/opt/buildingos/weekly-recovery-points/releases/<SHA>`, renders
absolute systemd paths for that release, writes the environment with capture
disabled, and rolls back the transaction on failure. It never enables the
weekly timer.

Activation requires a separate operational approval after local tests pass:

1. Install the service, timer, and a root-owned environment file with
   `BUILDINGOS_WEEKLY_RECOVERY_POINT_ENABLE=YES` only after review.
2. Create the shared lock parent with restricted ownership and permissions.
3. Run the synthetic failure, interruption, lock-contention, and retention
   tests on the target host without real backup data.
4. Define an operator procedure for a host crash or `SIGKILL` after the S3
   fence is applied but before the original policy is restored. Install the
   recovery service enabled at boot only after that procedure is approved.
6. Activate the timer separately and observe the first approved capture.

The shell trap restores the policy for ordinary errors and handled signals,
but it cannot run after `SIGKILL`, power loss, or host failure. Therefore this
preparation is not an authorization to activate the timer. The recovery
service attempts the exact restore only when the runtime identity, state
directory, and policy ownership checks pass. Otherwise it records
`NEEDS_MANUAL_RECOVERY`, leaves the API stopped, and emits a failed systemd
unit for alerting. A supervisor or manual procedure must then verify the
provider state before API traffic is resumed.

## Local validation

```text
bash scripts/tests/backup-recovery-point-weekly.test.sh
bash -n scripts/backup-recovery-point-weekly.sh \
  scripts/lib/production-operation-lock.sh
```

The real capture path requires Docker, the production runtime, and an
authorized S3 identity; none are used by the local synthetic tests.

## One-time controlled capture

After explicit approval for the host, window, identity, and one operation:

1. Confirm the production checkout, API/Web health, active image digest, daily
   backup freshness, and the shared lock are healthy. Do not change the
   deployed runtime.
2. Confirm the recovery service is installed and the lock parent is owned and
   writable only by its service account. Confirm the weekly environment file
   contains `BUILDINGOS_WEEKLY_RECOVERY_POINT_ENABLE=YES` and no credentials.
3. Run the service once with `systemctl start
   pawtech-buildingos-recovery-point-weekly.service`; do not start the timer.
4. Observe the journal without printing environment files or credentials.
   Require `WEEKLY_RECOVERY_POINT=PASS`, a complete receipt, restored policy,
   and healthy API/Web checks.
5. Independently inspect the published receipt, dump, manifests, object
   hashes, and the private fence evidence. Preserve sanitized evidence.
6. If the service fails or the recovery unit reports
   `NEEDS_MANUAL_RECOVERY`, keep the API stopped and do not retry until the
   exact policy state has been reviewed by an operator.
7. Only after reviewing this one result may a separate authorization request
   address timer activation. Retention remains dry-run only.
