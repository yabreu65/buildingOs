# STORAGE_01 Phase D Staging Rollout Preparation

## Status and Scope

This document prepares, but does not execute, the staging storage rollout. Gate
0 has been revalidated remotely against staging SHA
`c4b7195ab35d40a6481f34ad69a0ddfa7a9de488`. No Contabo bucket was created, no
object was copied or deleted, and no container was started, restarted, or
recreated during this preparation.

## Current and Target Architecture

The repository's current staging architecture uses a local MinIO service,
bootstrap service, and persistent Docker volume. The documented active bucket
is `buildingos-staging`. The API currently receives the local MinIO endpoint
and MinIO root credentials through hardcoded mappings in the staging Compose
file.

The target staging architecture uses a dedicated private Contabo S3-compatible
bucket. The API receives the provider endpoint, credentials, bucket, path-style
setting, and public presign endpoint through the external staging environment.
Development Compose remains local MinIO-backed, and production Compose is out
of scope for this change.

## Configuration-Only Classification

`CONFIG_ONLY` remains supported by repository evidence:

- `apps/api/src/config/config.ts` validates the `S3_*` variables;
- `apps/api/src/storage/minio.service.ts` constructs an S3-compatible client
  from the configured endpoint and credentials;
- path-style addressing is already a first-class setting; and
- no application code change is required to switch the S3-compatible provider.

The staging patch removes the unused local MinIO and bootstrap services from
the staging stack, removes the API dependency on them, and injects the seven
storage variables. `infra/docker/docker-compose.yml` and
`infra/docker/docker-compose.production.yml` are unchanged.

The patch is compatible with the current staging topology as a future
pre-cutover change: current staging still runs local MinIO at the verified Gate
0 SHA, while the patch defines the intended external-storage topology for the
next authorized staging rollout. This difference is intentional and is not a
runtime contradiction.

## Exact Storage Configuration Contract

These names are taken from the API configuration schema and staging Compose:

| Variable | Required | Rollout contract |
| --- | --- | --- |
| `S3_ENDPOINT` | Yes | Valid provider URL used for object operations |
| `S3_REGION` | Yes in Compose | Provider-confirmed signing region |
| `S3_ACCESS_KEY` | Yes | Dedicated staging access identity; inject externally |
| `S3_SECRET_KEY` | Yes | Dedicated staging secret; inject externally |
| `S3_BUCKET` | Yes | Approved dedicated staging bucket |
| `S3_FORCE_PATH_STYLE` | Yes in Compose | `true`; required by the validated provider behavior |
| `S3_PUBLIC_BASE_URL` | Yes | Valid provider URL used when generating presigned URLs |

`WEB_ORIGIN` remains a required staging application variable and must be
confirmed against the deployed staging web origin. It is separate from the
storage endpoint and must not be replaced by a storage URL.

`S3_PUBLIC_BASE_URL` is genuinely required for the current private presigned
workflow. The API configuration schema requires it as a valid URL, Compose
requires it for staging, and `MinioService` uses it for the separate presign
client while keeping object operations on the internal endpoint. Although the
service has a code-level fallback to `S3_ENDPOINT`, that fallback is not a
valid staging configuration because the schema and Compose contract fail
closed when `S3_PUBLIC_BASE_URL` is absent.

No values are populated in this repository. The secret contract is limited to
the Contabo staging access key and secret key. Non-secret rollout inputs are
the provider endpoint, region, approved bucket, `S3_FORCE_PATH_STYLE=true`,
public base URL, confirmed `WEB_ORIGIN`, and the approved disposition of
missing and orphaned objects.

## Gate 1: Final Contabo Staging Bucket Specification

The future target is a dedicated Contabo Object Storage bucket. This is a
specification only; the bucket must not be created as part of this preparation.

### Known

| Setting | Approved specification |
| --- | --- |
| Provider | Contabo Object Storage, S3-compatible API |
| Proposed bucket | `buildingos-staging` in the dedicated staging storage account |
| Endpoint format | `https://<contabo-region>.contabostorage.com` |
| Current staging web origin | `https://buildingos-staging.31-220-98-21.sslip.io` |
| Privacy | Private bucket; anonymous object reads denied |
| ACL policy | `private`; never `public-read` or anonymous listing |
| Addressing | Path-style required (`S3_FORCE_PATH_STYLE=true`) |
| Object keys | Preserve all 46 active-bucket keys exactly |
| CORS methods | `PUT` required; `GET` and `HEAD` allowed for compatible read/stat flows |
| CORS request headers | `Content-Type` required by the browser upload XHR |
| CORS credentials | Not required for direct presigned object requests |
| Tenant isolation | API authorizes before presigning; bucket remains private; keys remain tenant-scoped |

The browser upload code sends a direct presigned `PUT` with only the
`Content-Type` request header. The API's `Authorization`, `X-Tenant-Id`, and
`X-Portal-Context` headers are not sent to object storage. `OPTIONS` is the
browser preflight mechanism, not an application object method, and must not be
used to broaden access policy.

Versioning, lifecycle, and encryption controls:

- Recommend enabling object versioning before cutover if supported by the
  Contabo target, because it improves recovery from accidental replacement.
  The current staging MinIO bucket reported no enabled versioning status.
- Configure no lifecycle expiration for active application objects or the six
  preserved orphans. Any later noncurrent-version retention rule requires a
  separate review.
- Require provider-managed SSE at rest if available. Phase C observed SSE
  behavior, but the exact Contabo SSE mode and key-management contract require
  provider confirmation; application-side encryption is not introduced here.

The Phase C Contabo CORS exception remains narrow: an exact configured origin
was functionally accepted, while the provider returned
`Access-Control-Allow-Origin: *`. This does not make the bucket public, does
not permit credentials, and does not weaken BuildingOS API CORS. It must be
recorded as a Contabo-specific semantic deviation only.

### Manual input required

- exact Contabo endpoint host;
- exact Contabo signing region;
- confirmation that the proposed bucket name is available in the dedicated
  staging account;
- confirmation of private ACL/policy and anonymous denial;
- confirmation of versioning, lifecycle, and SSE capabilities; and
- provider-side application of the exact current staging web origin.

## Gate 1 Approval Boundary

Gate 1 is specification-complete but not execution-approved until the manual
provider inputs above are supplied and reviewed. No bucket creation or policy
change is authorized by this document.

## Migration Classification

The current verified classification is `REQUIRED_DATA_MIGRATION`. The active
bucket contains 46 objects, including payment evidence, generated receipts,
tenant/application objects, and pilot-data-pack seed objects. Six active-bucket
objects are orphaned but are explicitly preserved. Six database references
target legacy bucket names and are excluded from the storage migration repair;
they require a later separately approved follow-up.

## Migration Plan: Copy, Verify, Switch

The approved future migration copies all 46 objects from the current
`buildingos-staging` MinIO bucket to a separate dedicated Contabo bucket. The
six orphan objects are included. The six legacy database references are not
repaired by this migration.

1. Capture a read-only pre-copy source inventory and retain the verified
   baseline of 46 objects and 2,304,956 bytes.
2. Generate a source manifest containing each exact key, byte size,
   Content-Type, relevant metadata, and a SHA-256 digest calculated without
   exposing object bodies.
3. Copy all source objects to the approved dedicated destination bucket.
4. Preserve every object key exactly; do not normalize, rename, or flatten
   tenant prefixes.
5. Preserve each source Content-Type.
6. Preserve relevant source metadata, excluding only provider-generated fields
   that cannot be transferred.
7. Calculate destination SHA-256 digests and record comparable integrity
   evidence for every object.
8. Verify the destination object count is 46.
9. Reconcile destination count and total bytes against the source manifest.
10. Make retries resumable and idempotent: an existing destination key with
    matching metadata and digest is skipped; a mismatch stops the migration for
    review.
11. Record failed objects separately and do not switch while any object is
    missing or unverified.
12. Perform a final manifest comparison, including all 46 objects, then obtain
    explicit cutover approval.
13. Switch staging configuration only after complete verification. Keep the
    source MinIO service, volume, and original data intact throughout the
    migration and rollback window.

Provider ETags must not be treated as an MD5 or sole integrity proof. SHA-256
content digests plus byte size, key, Content-Type, and relevant metadata are
the portable integrity evidence. No source deletion, target cleanup, object
rename, or database repair is part of this plan.

## Gate 0 and Future Execution Gates 1-10

Gate 0 is complete and passed as a read-only inventory. The following gates are
the future execution sequence and are not executed by this document.

| Gate | Entry condition | Validation and PASS condition | STOP condition and rollback trigger |
| --- | --- | --- | --- |
| 1. Bucket | Gate 0 evidence accepted; provider inputs approved | Dedicated `buildingos-staging` Contabo bucket exists, is private, uses approved endpoint/region/path style, and passes policy/CORS checks | Wrong account, bucket, region, privacy, or CORS result; do not continue |
| 2. Secrets | Gate 1 PASS; protected destination available | All required values are installed only in the protected staging environment and Compose renders without values in output | Missing/invalid value, secret exposure, or unsafe destination; restore prior protected configuration |
| 3. Copy | Gates 1-2 PASS; source manifest captured | All 46 active-bucket objects copy successfully with exact keys and recorded statuses | Any failed, missing, or unexpected object; keep MinIO and do not switch |
| 4. Integrity | Gate 3 reports complete copy | Destination SHA-256, byte total, object count, Content-Type, and relevant metadata match source manifest | Any mismatch or unverifiable object; preserve both sides and stop |
| 5. Switch | Gates 1-4 PASS; rollback record captured | Staging API receives external `S3_*` contract and starts without local MinIO dependency | API/config failure or wrong endpoint; trigger rollback to prior MinIO values |
| 6. Health | Gate 5 PASS | API, web, PostgreSQL, Redis, mail, and provider connectivity/readiness pass | Health/readiness failure; revert application storage configuration |
| 7. Server storage smoke | Gate 6 PASS | Server-side stat, presigned PUT/GET, private access, path-style, and integrity checks pass | Any storage or privacy failure; trigger rollback before browser testing |
| 8. Browser smoke | Gate 7 PASS | Real browser upload/download works from the exact staging origin with no credentials sent to storage | CORS, upload, download, or credential behavior failure; rollback and preserve target |
| 9. Isolation | Gate 8 PASS | Tenant authorization, key scoping, anonymous denial, and production isolation pass | Cross-tenant/public access or production impact; immediate rollback and incident review |
| 10. Acceptance or rollback | Gates 1-9 evidence complete | Responsible owner accepts cutover and retains manifests/rollback record, or explicitly rolls back | Any unresolved evidence, legacy-reference risk, or owner rejection; execute rollback contract |

## Smoke Matrix

| Area | Check | Expected result |
| --- | --- | --- |
| Startup | API starts with all seven storage variables | Configuration validation passes |
| Connectivity | Storage health/check operation | Dedicated bucket is reachable |
| Signing | Presigned upload and download | URLs target configured provider and bucket |
| Upload | Direct browser-compatible presigned `PUT` | Upload succeeds without credentials/cookies |
| Download | Presigned `GET` or navigation | Authorized object is readable |
| Privacy | Anonymous object request | Denied |
| Authorization | API authorization before presign | Only authorized caller receives URL |
| Addressing | Path-style URL behavior | Works; virtual host is not required |
| CORS | Browser upload from confirmed `WEB_ORIGIN` | Functional; record Contabo wildcard deviation |
| Integrity | SHA-256 and byte-size comparison | Exact match for migrated/test objects |
| Reconciliation | DB `File` rows versus bucket keys | No unexplained missing references |
| Cleanup | Exact-key deletion in controlled test only | Only approved test key is removed |
| Isolation | Production health/configuration | Unchanged |

## Rollback Contract

Retain the old staging MinIO service, volume, Compose revision, and original
objects until acceptance is complete. If Contabo fails at any cutover gate:

1. Stop the rollout and preserve the Contabo bucket and its manifests; do not
   delete target objects.
2. Restore the previous staging `S3_*` values that point to the existing MinIO
   endpoint and bucket through the protected environment mechanism.
3. Recreate only the required staging application service(s) under an
   separately authorized deployment; never recreate or delete the MinIO data
   service as part of rollback.
4. Verify API, web, storage health, private access, and representative object
   reads against MinIO.
5. Reconcile the failed-cutover write window before permanent return to MinIO.

During a failed cutover, track every Contabo object written after the switch
from the deployment time boundary and final object manifest. Compare those
keys with database locator changes and the MinIO source. Before returning
permanently to MinIO, copy any required post-switch objects back to MinIO with
the same key, Content-Type, metadata, and SHA-256 verification, or retain a
separate approved recovery plan if the database references cannot be safely
reconciled. Do not delete Contabo data as a rollback step. The database is not
automatically rolled back by this storage configuration change.

## Risks

- Six legacy bucket references need a separate historical-source investigation;
  they are not active-bucket migration repairs.
- Database and object storage are not one atomic transaction; partial uploads
  and missing objects are possible.
- A wrong bucket, endpoint, or credential could cause cross-environment access;
  dedicated names and protected injection are mandatory.
- The Contabo CORS wildcard is functionally compatible but is a provider
  semantic deviation; it must not become a general security policy.
- Removing local MinIO from the staging Compose stack makes missing external
  configuration fail closed at Compose or API startup rather than silently
  falling back to local storage.
- No production path is changed by this patch, but production must remain out
  of all rollout commands.

## Gate 3 Final Secret and Configuration Contract

All values below belong in the protected staging environment file at
`/opt/pawtech/env/buildingos-staging.env`, or an equivalent protected injector;
none belong in Git or release evidence.

| Variable | Secret | Expected format | Provider/source | Status |
| --- | --- | --- | --- | --- |
| `S3_ENDPOINT` | NO | HTTPS Contabo S3 endpoint URL | Approved Contabo account | Manual exact host required |
| `S3_REGION` | NO | Provider signing-region string | Contabo region discovery | Manual exact value required |
| `S3_ACCESS_KEY` | YES | Non-empty dedicated staging access key | Contabo staging account | Manual protected input required |
| `S3_SECRET_KEY` | YES | Non-empty dedicated staging secret key | Contabo staging account | Manual protected input required |
| `S3_BUCKET` | NO | `buildingos-staging` | Approved dedicated Contabo bucket | Proposed value known; creation/approval required |
| `S3_FORCE_PATH_STYLE` | NO | `true` | BuildingOS/Contabo compatibility requirement | Known |
| `S3_PUBLIC_BASE_URL` | NO | HTTPS provider URL without a signature | Contabo public S3 endpoint | Manual exact value required |
| `WEB_ORIGIN` | NO | HTTPS staging web origin | Current staging configuration | Known: `https://buildingos-staging.31-220-98-21.sslip.io` |

The access key and secret key are the only secret values in this storage
contract. Manual inputs required before bucket creation are the exact endpoint,
Contabo signing region, dedicated-account bucket approval, access key, secret
key, public base URL, private-policy confirmation, and provider CORS
configuration. The six legacy reference and six orphan dispositions remain
separate approval items; orphans must remain preserved.

Secrets must not be printed, committed, or copied into release evidence.

## Gate 1 Execution Evidence

Gate 1 was executed against the approved dedicated Contabo target using
protected environment variables inherited by the execution process. No
credential values, object keys, or signed URLs were recorded.

| Check | Result |
| --- | --- |
| Provider physical region | US-central |
| S3 endpoint | `https://usc1.contabostorage.com` |
| S3 signing region | `default` |
| Bucket | `buildingos-staging` |
| Bucket existence before Gate 1 | Did not exist |
| Bucket creation | Created during Gate 1 |
| Authenticated bucket access | PASS |
| Privacy | PASS: private ACL with only the owner `FULL_CONTROL` grant; no bucket policy exists |
| Anonymous listing | PASS: rejected with `401` |
| Anonymous object access | PASS: rejected with `401` |
| Path-style SigV4 presigned access | PASS |
| Bucket versioning | PASS: enabled |
| Object Lock | NO: it was not enabled at bucket creation |
| Lifecycle expiration | NO: the new bucket has no configured lifecycle policy |
| Bucket-level SSE configuration | Not configured by the S3 API; the smoke-object response did not report an SSE mode |
| Stored CORS rule | PASS: exact staging origin, `PUT`/`GET`/`HEAD`, `Content-Type`, and no credentials |
| CORS preflight | PASS |
| Temporary smoke object | Used, integrity verified by authenticated retrieval and matching MD5 ETag, then permanently deleted by exact version ID |
| Application objects migrated | 0 |

The browser-compatible CORS preflight from the exact staging origin returned
`Access-Control-Allow-Origin: *`, the accepted Contabo semantic deviation for
this private non-credentialed presigned workflow. The provider response also
listed more allowed methods than the stored minimal rule. CORS does not grant
object authorization; anonymous reads and listing remained rejected, and no
public ACL or bucket policy was configured.

The provider returned an empty lifecycle/Object Lock response that the AWS CLI
image could not deserialize. The lifecycle conclusion is supported by the
new-bucket creation and the absence of any lifecycle configuration write.

Gate 1 is `PASS`. Protected staging credential installation may proceed under
separate authorization. Object migration and staging cutover remain blocked
pending their separately authorized gates.

## Gate 2 Protected Candidate Environment Evidence

Gate 2 created the separate future-cutover candidate at
`/opt/pawtech/env/buildingos-staging-contabo-storage.env`. It is outside the
Git checkout, is a regular file owned by the staging deployment user, and has
mode `0600`. It is not the active staging environment file and was not applied
to any running service.

| Check | Result |
| --- | --- |
| Candidate environment installed | YES |
| Candidate variable names | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_BASE_URL` only |
| Required values | Present and non-empty; values not recorded |
| Remote Contabo authentication | PASS |
| Remote bucket reachability | PASS |
| Target application objects | 0 |
| Active staging environment unchanged | YES, byte-for-byte |
| Staging runtime unchanged | YES; no container was restarted, recreated, stopped, or replaced |

The remote connectivity check used the candidate in a subshell to map the
protected S3 variables to the temporary AWS CLI environment. It performed only
authenticated `HeadBucket` and `ListObjectsV2` operations. No object upload,
application configuration change, MinIO change, or deployment occurred.

Gate 2 is `PASS`. The candidate remains preparation-only; the active
`/opt/pawtech/env/buildingos-staging.env` file continues to configure the
authoritative staging MinIO storage.

## Gate 3A S3 Transport Diagnostic

Gate 3 remains blocked. The diagnostic performed no application-object copy
beyond the existing partial target, no source mutation, no deployment, and no
cutover. All synthetic objects used the reserved `__storage01` diagnostic
namespace and were deleted by their exact version IDs.

| Check | Result |
| --- | --- |
| Previous client | AWS CLI `2.36.34`, `s3api put-object`, explicit `Content-Type`, no explicit checksum-mode settings |
| Current partial destination count | 6 source objects |
| Partial SHA-256 / size matches | 6/6 / 6/6 |
| Partial exact Content-Type matches | 5/6 |
| Partial stored `aws-chunked` response | Present on all 6 |
| Default synthetic `text/plain` | SHA-256 and size passed; Contabo returned `text/plain; charset=UTF-8` and `aws-chunked` |
| Required-only synthetic `text/plain` | SHA-256 and size passed; Contabo still returned `text/plain; charset=UTF-8`; `aws-chunked` absent |
| Required-only synthetic binary control | SHA-256, size, and exact `application/octet-stream` passed; `aws-chunked` absent |
| Synthetic cleanup | PASS |

The prior count report is reconciled: six is the authoritative unique target
object count. The additional skipped count described the earlier matching
object revalidation during a retry and must not be added to the final count.

The evidence establishes both a client transport behavior and a provider
normalization. AWS CLI default checksum behavior produced the stored
`aws-chunked` response, which the required-only settings removed. Contabo
continued to append the charset parameter to an explicitly supplied
`text/plain` value with required-only checksums and known content length.

BuildingOS upload validation uses exact MIME allowlists, including
`text/plain`; it does not accept `text/plain; charset=UTF-8` as the same
allowed value. Gate 3 therefore cannot adopt semantic Content-Type equivalence
without an explicit application-security change. The recommended Gate 3
acceptance rule is `BLOCK_PROVIDER_INCOMPATIBILITY`.

If a separately approved compatible target or provider remedy becomes
available, a future resume must use
`AWS_REQUEST_CHECKSUM_CALCULATION=when_required` and
`AWS_RESPONSE_CHECKSUM_VALIDATION=when_required`, explicit per-object
Content-Type, known content length, exact keys, and SHA-256 verification. The
six partial objects require revalidation and reupload only under a separately
authorized compatible resume; no mutation was made in this diagnostic.

## Gate 3 Idempotent Migration Resume Evidence

At `2026-08-29T02:50:06Z`, the separately authorized resume copied and
verified the complete MinIO source set to the private Contabo destination. The
active staging environment was not changed, no service was restarted, and
BuildingOS continues to use staging MinIO as the rollback authority.

| Check | Result |
| --- | --- |
| Source / destination object count | 46 / 46 |
| Source / destination bytes | 2,304,956 / 2,304,956 |
| Exact key set | 46/46 |
| SHA-256 matches | 46/46 |
| Size matches | 46/46 |
| MIME-compatible matches | 46/46 |
| Exact Content-Type matches | 45/46 |
| Approved `text/plain` UTF-8 normalization | 1/46 |
| Current destination `aws-chunked` metadata | Absent: 46/46 |
| Prior partial objects | 6 revalidated and reuploaded with version history retained |
| Remaining source objects copied | 40 |
| Orphan source objects preserved | 6/6 |
| Source MinIO | Retained, unchanged, 46 objects |
| Legacy database references | 6 remain untouched |
| Active staging storage | MinIO; cutover not performed |

Destination verification used required-only AWS checksum behavior, explicit
source Content-Type, exact object keys, and per-object SHA-256 verification.
The only semantic MIME match was the approved `text/plain` to
`text/plain; charset=UTF-8` normalization; no other parameterized MIME
comparison was accepted. Gate 3 is `PASS` for copy and verification only.

## Gate 4D Public MinIO Network Isolation Barrier Evidence

Gate 4D proved a reversible public-write barrier without modifying application
storage configuration, restarting MinIO or Traefik, or changing application
objects. The barrier temporarily detached only `buildingos-staging-minio` from
the `pawtech_public` Docker network. Its internal
`buildingos-staging_buildingos_staging_net` attachment remained in place.

| Check | Result |
| --- | --- |
| Baseline public presigned PUT | PASS; SHA-256 and size verified, then synthetic object deleted |
| Stale public presigned PUT during isolation | PASS: rejected; no target object was created |
| Public old MinIO GET/HEAD during isolation | PASS: unavailable as intended; both returned backend-unavailable responses |
| MinIO container and health during isolation | PASS: running and healthy; no restart or recreation |
| Internal HEAD/GET/list/manifest during isolation | PASS |
| Source application manifest during isolation | PASS: 46 objects and 2,304,956 bytes, unchanged |
| `pawtech_public` restoration | PASS; original public IPv4 and aliases restored |
| Public files endpoint after restoration | PASS |
| Same stale presigned PUT after restoration | PASS; SHA-256 and size verified |
| Synthetic cleanup | PASS; no `__storage01/network-barrier-proof/` object remained |
| Production / database / active storage env | Unchanged |

The resulting future cutover contract is:

1. Enter maintenance and make the API unavailable to quiesce internal MinIO
   writes.
2. Detach MinIO from `pawtech_public` to reject stale browser presigned URLs.
3. Capture the final source manifest through the internal staging network,
   synchronize any delta, and verify Contabo integrity.
4. Activate the protected Contabo environment and deploy only the approved API
   and web application services.
5. Keep MinIO running with its data intact for rollback.

The public network barrier does not stop internal API traffic to
`http://minio:9000`; API quiescence is therefore mandatory before the final
source manifest. If rollback is required after Contabo writes begin, quiesce
the API, reconcile Contabo-window objects back to MinIO with key, SHA-256,
size, and MIME verification, restore the prior protected environment, ensure
MinIO is attached to `pawtech_public`, then deploy the prior application
configuration.

### Traefik Provider Technical Debt

Gates 4B and 4C established `OPS_TECH_DEBT_TRAEFIK_PROVIDER_WATCH`:
Traefik v3.7's Docker provider did not register temporary labeled containers
at the data plane, even though the existing long-running files router works.
The Traefik API is disabled, which prevented direct router inspection. This
issue is not a dependency of the proven Docker-network isolation barrier and
requires a separate infrastructure follow-up.
Staging cutover remains a separately authorized gate.
