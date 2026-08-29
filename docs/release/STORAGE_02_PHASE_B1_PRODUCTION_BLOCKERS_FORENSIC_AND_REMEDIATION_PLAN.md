# STORAGE_02 Phase B1 Production Blockers Forensic and Remediation Plan

## Decision

`NEEDS_MANUAL_BUSINESS_DISPOSITION`

Production remains `BLOCKED / NOT READY` for STORAGE_02 migration. This phase
was read-only. No production object, database row, bucket policy, container,
network, environment file, checkout, Contabo resource, or staging resource was
modified.

Read-only evidence was collected on 2026-08-29 in the protected temporary
directory `/tmp/storage02-b1-evidence-20260829` on `vmi3361868`. Object names,
bodies, credentials, PII, and raw database identifiers were not emitted.

## 1. Safety Baseline

- Production runtime SHA: `c987eacdfe5e9f5b3772d498bb1b4fd77859dfdc`.
- `buildingos-api`: running, healthy, HTTP health 200.
- `buildingos-web`: running, healthy, HTTP root 200.
- `pawtech-postgres`: running and healthy.
- `pawtech-redis`: running and healthy.
- `buildingos-minio`: running and healthy, HTTP health 200.
- `pawtech-traefik`: running; Docker healthcheck is not configured; HTTPS
  routes served successfully.
- No material runtime drift from Phase A was observed.
- The production checkout remains dirty with the same four paths reported in
  Phase A.

The production MinIO bucket state remains 2 objects and 2,093 bytes. Both
objects are still referenced by valid active-bucket `File` rows.

## 2. Dirty Checkout Forensics

### Captured state

- `git status --short` and `git status --porcelain=v2` were captured.
- `git diff --stat`, `git diff --name-status`, and the full unstaged diff were
  captured privately.
- Cached stat, name-status, and full cached diff were captured privately.
- `git ls-files --others --exclude-standard` was captured privately.
- There are no staged changes.

### Path classification

| Path | Classification | Runtime impact | Later disposition |
| --- | --- | --- | --- |
| `infra/docker/docker-compose.staging.yml` | A: legitimate staging-only storage cutover source change | No effect on running production images; can affect future commands using this checkout | Preserve and integrate/review before restoring the tracked file |
| `docs/release/STORAGE_01_PHASE_C_EVIDENCE.md` | C: operational evidence | None | Archive outside checkout or integrate through normal Git workflow |
| `docs/release/STORAGE_01_PHASE_D_GATES_0_3_READINESS.md` | C: operational evidence | None | Archive outside checkout or integrate through normal Git workflow |
| `docs/release/STORAGE_01_PHASE_D_STAGING_ROLLOUT_PREPARATION.md` | C: operational evidence | None | Archive outside checkout or integrate through normal Git workflow |

No changed path is an environment file, credential file, secret, runtime
volume, or ignored sensitive file. The tracked Compose change is staging-only
and is not baked into the running `c987eac` production API/web images.

`RUNNING_BEHAVIOR_AFFECTED_BY_DIRTY_CHECKOUT=NO` for current production
containers. The checkout is still operationally unsafe to use for a future
deployment until its contents are preserved and classified.

### Future cleanup sequence

1. Preserve hashes, status, and diffs outside the production checkout.
2. Archive the three evidence documents outside the checkout, or explicitly
   integrate them through the normal source/release workflow.
3. Review the staging Compose change against the intended STORAGE_01 source
   history and current main.
4. If the change is represented or superseded by an approved source commit,
   use `git restore -- infra/docker/docker-compose.staging.yml` in a separately
   authorized cleanup step.
5. Do not use `git clean` for the evidence documents; remove them only after
   archival and explicit approval.
6. Verify clean status, ignored-file policy, and the exact intended deployment
   SHA.

`PRODUCTION_CHECKOUT_CLEANUP=REQUIRES_MANUAL_REVIEW`.

## 3. Production Versus Main

Compared with the locally authoritative `origin/main` at
`883b3a60d6b8727703f563ec3f7c4e1c40d50da5`:

- Production is 33 commits behind.
- Production is 0 commits ahead.
- No production-only commits were identified.
- Production predates STORAGE_01 staging preparation and rollout commits,
  including PRs #207 and #208.
- The production checkout's own `origin/main` ref still points to the old
  production SHA; it was not fetched or changed during this phase.

The future production target must be the current approved main commit or a
later dedicated STORAGE_02 merge SHA. It must not be `c987eac`.

## 4. Anonymous MinIO Capability Matrix

Anonymous access was tested without credentials. Known object content was
discarded to `/dev/null`; no body was displayed.

| Capability | Result |
| --- | --- |
| `ANONYMOUS_LIST` | `ALLOW` |
| `ANONYMOUS_HEAD` | `ALLOW` |
| `ANONYMOUS_GET` | `ALLOW` |
| `ANONYMOUS_PUT` | `NOT_TESTED` |
| `ANONYMOUS_DELETE` | `NOT_TESTED` |

Anonymous `LIST` and `HEAD` also succeed against the internal MinIO endpoint,
so the exposure is not caused only by Traefik. An `OPTIONS` request returned
HTTP 200, but it was not used to infer PUT authorization.

## 5. Current Policy and Root Cause

Authenticated, read-only inspection found:

- `mc anonymous get` reports `download` for `buildingos`.
- The bucket policy contains two public `Allow` statements with `Principal: *`:
  - `s3:GetBucketLocation` and `s3:ListBucket`.
  - `s3:GetObject`.
- No public ACL grant was found.
- The policy-status API reports `IsPublic=false`, which conflicts with the
  explicit policy and observed anonymous behavior.
- The repository's bootstrap intent is private access via
  `mc anonymous set none`.

`CURRENT_MINIO_ANONYMOUS_POLICY_CLASSIFICATION=BUCKET_POLICY_DRIFT`.

`TRAEFIK_ONLY` is ruled out. A separate global MinIO configuration cause was
not required to explain the observed access; the explicit bucket policy is
the actionable cause. The policy-status inconsistency should be documented as
a MinIO/API semantic discrepancy and not treated as evidence of safety.

## 6. Private-Bucket Compatibility

`PRIVATE_BUCKET_COMPATIBLE_WITH_CURRENT_APP=YES`, with controlled production
smoke verification still required after any authorized change.

Reasoning:

- `DocumentsController` requires JWT and tenant access guards.
- The application authorizes before returning presigned URLs.
- `MinioService` signs PUT and GET requests with the configured credentials.
- Existing STORAGE_01 Contabo evidence passed private-bucket enforcement,
  presigned PUT/GET, authenticated stat, and browser-compatible CORS behavior.
- Restoring anonymous `none` does not invalidate SigV4-signed PUT or GET
  requests.

The production API currently signs against the public MinIO base URL. MinIO
must not be detached from `pawtech_public` while it remains the active storage
backend, because doing so would break the current browser presigned flow.

## 7. Minimal Security Remediation Design

No command was executed. The smallest reversible future fix is:

```text
mc anonymous set none <production-alias>/buildingos
```

Required preconditions:

1. Capture the exact current bucket policy and ACL privately.
2. Preserve the current object manifest and authenticated health evidence.
3. Confirm the operator is using the production MinIO alias and bucket.
4. Apply only the bucket anonymous-policy change.
5. Verify anonymous LIST, HEAD, and GET are denied.
6. Verify authenticated application presign generation and signed PUT/GET.
7. Verify application health, readiness, and document access.

Rollback must restore the exact captured policy JSON, not a generic assumed
policy. `REMEDIATION_ROLLBACK_PLAN_DEFINED=YES`.

## 8. Seven Legacy References

Private forensic evidence captured a row identifier fingerprint, tenant
fingerprint, bucket, object-key fingerprint, timestamps, size, MIME type,
document category, visibility, scope, and relation counts for each row. Raw
identifiers, titles, filenames, and object keys are intentionally absent from
this report.

| Bucket | Rows | Categories | Visibility | Current app semantics |
| --- | ---: | --- | --- | --- |
| `demo-documents` | 5 | `BUDGET`, `CONTRACT`, `INVOICE`, `MINUTES`, `RULES` | 3 `RESIDENTS`, 1 `TENANT_ADMINS`, 1 `PRIVATE` | Authorized application records; download expected to fail because bucket is absent |
| `documents` | 2 | `OTHER`, `RULES` | 1 `TENANT_ADMINS`, 1 `RESIDENTS` | Authorized application records; download expected to fail because bucket is absent |

All seven rows have `Document` records. Four are resident-visible, two are
tenant-admin-visible, and one is private to its creator/admin. None is linked
as payment proof or payment receipt. No quote, import, expense attachment,
income attachment, or tenant logo relation is involved.

### Business classification

- `REAL_BUSINESS_RECORD=0` evidenced.
- `DEMO_RECORD=7` technically indicated: all seven identifiers are
  demo/seed-like; the two `documents` rows exactly match known repository demo
  seed IDs.
- `TEST_RECORD=0` indicated.
- `OBSOLETE_RECORD=0` formally proven.
- `UNKNOWN_RECORD=0` technically indicated, but business-owner confirmation is
  still required before deletion or rewriting.
- `BUSINESS_CRITICAL_LEGACY_REFERENCE_COUNT=0` based on current database
  relations and repository evidence.

### Recovery search

- Current MinIO buckets contain only `buildingos` and `buildingos-local`; the
  legacy buckets do not exist.
- No exact legacy object was found in any existing production bucket.
- Repository fixtures contain metadata for the two known demo seed documents,
  but no matching object bodies.
- The repository contains no matching legacy object artifact; its unrelated
  PDF is not an identity match.
- Local production backup roots exist, but no production MinIO backup root or
  approved backup-storage environment was available for an exact object
  recovery query.
- No staging search was performed because no exact legacy object fingerprint
  justified treating staging as a recovery source.

Per-reference recovery classification:

- `RECOVERABLE_EXACTLY=0`.
- `RECOVERABLE_WITH_UNCERTAINTY=0`.
- `NO_OBJECT_FOUND=7`.
- `DEMO_OR_TEST_DISPOSITION_CANDIDATE=7`.

`SILENT_DB_DELETION_RECOMMENDED=NO`.

Required future disposition options are explicit and per-record or per-proven
demo set: `RECOVER_OBJECT`, `MARK_DOCUMENT_UNAVAILABLE`,
`REMOVE_CONFIRMED_DEMO_DATA`, or another approved disposition. No database
change is authorized in B1.

## 9. Dirty Checkout Remediation Design

The checkout cannot be cleaned deterministically without preserving and
reviewing the evidence documents and staging-only Compose change.

`git restore` may later be used for the tracked staging file only after source
integration or explicit approval. The three untracked evidence files require
archival or normal Git integration before deletion. No production runtime
behavior currently depends on these on-disk files.

## 10. STORAGE_02 Repository Preparation Impact

`STORAGE_02_PRODUCTION_REPOSITORY_CHANGES_REQUIRED=YES`.

Planned files and areas:

- `infra/docker/docker-compose.production.yml`
  - Externalize all seven S3 settings through the protected production
    environment contract.
  - Remove API dependency on local MinIO.
  - Remove local MinIO as the authoritative application service and its public
    Traefik route for the post-cutover topology.
  - Preserve the existing MinIO volume/container through a separate,
    retention-only legacy definition or equivalent operator-owned mechanism.
  - Never delete the legacy volume automatically.
- `infra/docker/.env.production.example`
  - Document the complete seven-variable external-storage contract without
    real values.
- `scripts/deploy-production.sh`
  - Fail closed when the target still points at local MinIO.
  - Validate the external endpoint, bucket, region, path-style setting, public
    presign endpoint, and protected credential presence without printing
    secrets.
  - Preserve source MinIO for rollback and never remove its volume.
  - Keep exact-SHA, backup, migration, health, and rollback evidence gates.
- `.github/workflows/deploy-production.yml`
  - Include and validate any new production storage guard in the trusted
    exact-SHA deployment bundle.
- `scripts/tests/deploy-production-storage-cutover-guard.test.sh`
  - Add focused tests for local-target rejection, required external settings,
    legacy MinIO retention, network barrier, and rollback-preservation rules.
- `docs/release/STORAGE_02_PHASE_B1_PRODUCTION_BLOCKERS_FORENSIC_AND_REMEDIATION_PLAN.md`
  - Preserve this decision and the no-mutation boundary.

`PRODUCTION_CUTOVER_GUARD_REQUIRED=YES`.

## 11. Recommended Sequence

1. Apply the separately authorized minimal anonymous-policy fix while keeping
   MinIO attached to its current networks; verify signed application flow.
2. Obtain explicit business disposition for all seven demo-like legacy rows.
3. Preserve the dirty checkout evidence and complete manual source review.
4. Prepare and locally validate the STORAGE_02 production repository PR.
5. Provision and verify the dedicated private Contabo production target.
6. Copy and verify the approved object scope without deleting local source data.
7. Switch the application to the external target using the exact-SHA guarded
   deployment path.
8. Retain local MinIO and its volume for the agreed rollback window; clean up
   only under a later explicit approval.

## 12. Zero-Mutation Attestation

- Production DB writes: `0`.
- Production object writes: `0`.
- Production object deletes: `0`.
- Production policy changes: `0`.
- Production container restarts: `0`.
- Production network mutations: `0`.
- Production env mutations: `0`.
- Production checkout mutations: `0`.
- Contabo mutations: `0`.
- Staging mutations: `0`.
- Secrets exposed: `NO`.

## Final Report

`STORAGE_02_PHASE_B1_PRODUCTION_BLOCKERS_FORENSIC_COMPLETE`

- Production runtime SHA: `c987eacdfe5e9f5b3772d498bb1b4fd77859dfdc`.
- Production checkout dirty: `YES`.
- Dirty path count: `4`.
- Dirty path classifications: 1 legitimate staging-only source change; 3
  operational evidence files; no secret/runtime files.
- Running behavior affected by dirty checkout: `NO`.
- Production checkout cleanup classification:
  `REQUIRES_MANUAL_REVIEW`.
- Production versus main: 33 commits behind, 0 ahead; no production-only
  commits; current main is `883b3a60…`.
- Anonymous listing: `ALLOW`.
- Anonymous HEAD: `ALLOW`.
- Anonymous GET: `ALLOW`.
- Anonymous PUT: `NOT_TESTED`.
- Anonymous DELETE: `NOT_TESTED`.
- Current MinIO anonymous policy classification: `BUCKET_POLICY_DRIFT`.
- Repository policy intent is private: `YES`.
- Private bucket compatible with current presigned app flow: `YES`, with
  controlled production smoke verification after remediation.
- Proposed minimal exposure remediation: authenticated
  `mc anonymous set none <production-alias>/buildingos`.
- Remediation rollback plan defined: `YES`.
- Legacy references total: `7`.
- Real business records: `0` evidenced.
- Demo records: `7` indicated.
- Test records: `0` indicated.
- Obsolete records: `0` formally proven.
- Unknown records: `0` technically indicated; manual confirmation required.
- Recoverable exactly: `0`.
- Recoverable with uncertainty: `0`.
- No object found: `7`.
- Business-critical unrecoverable references: `0` evidenced.
- Recommended disposition: preserve current rows, seek business confirmation,
  recover only from an exact approved source, otherwise mark unavailable or
  remove only confirmed demo data in a separately authorized transaction.
- Silent DB deletion recommended: `NO`.
- STORAGE_02 production repository changes required: `YES`.
- Planned repository files: production Compose, production env template,
  production deploy script, production workflow guard bundle, focused storage
  cutover tests, and release documentation.
- Production cutover guard required: `YES`.
- Recommended blocker-remediation sequence: security containment, manual
  legacy disposition, checkout preservation/cleanup, repository PR, Contabo
  target provisioning, copy/verify, cutover.
- Production DB writes: `0`.
- Production object writes: `0`.
- Production object deletes: `0`.
- Production policy changes: `0`.
- Production container restarts: `0`.
- Production network mutations: `0`.
- Production env mutations: `0`.
- Production checkout mutations: `0`.
- Contabo mutations: `0`.
- Staging mutations: `0`.
- Secrets exposed: `NO`.

## Exact Blockers

1. Anonymous production MinIO listing, metadata, and object GET access remain
   allowed by bucket-policy drift.
2. Seven user-visible document records point to unavailable legacy buckets;
   they appear to be demo data, but deletion or rewriting still requires
   explicit business disposition.
3. The production checkout is dirty and 33 commits behind current main, so it
   is not a safe deployment source.
4. Dedicated Contabo production resources are not provisioned or verified.

## Exact Next Recommended Action

Authorize a separately controlled bucket-policy-only security change to restore
`anonymous=none`, with the captured-policy rollback and signed-flow checks
above. Do not detach MinIO from `pawtech_public`, clean the checkout, alter the
seven database records, provision Contabo, or deploy until those actions are
separately authorized.

## Dated Follow-up (2026-08-29)

This historical B1 decision has been superseded by the authorized follow-up
phases:

- B2 resolved the anonymous MinIO exposure. The production `buildingos` bucket
  is private; anonymous LIST, HEAD, and GET are denied and signed access passed.
- B4 resolved the seven approved legacy demo/seed references by deleting exactly
  seven `Document` rows and seven associated `File` rows. The two active pairs
  and two active objects totaling 2,093 bytes were preserved and verified.
- B5 preserved all production checkout content before path-scoped cleanup and
  left the checkout clean at `c987eacd...` without deployment.
- B5R refreshed `origin/main` to `883b3a60...` and proved the preserved staging
  Compose change is semantically superseded by current main. No integration of
  that old patch is required.

Phase C is repository preparation only. It does not provision Contabo, copy
production storage, mutate production, or authorize deployment.
