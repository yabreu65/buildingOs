# STORAGE_01 Phase D Gates 0-3 Readiness

## Overall Status

Gate 0 read-only remote revalidation is complete. Gates 1-3 remain specified
or prepared, but this document does not authorize bucket creation, migration,
cutover, deployment, or cleanup.

No MinIO object, database row, bucket, credential, or container was modified.

## Gate 0: Read-Only Inventory

### Repository facts

- Staging Compose identifies the storage architecture as a local MinIO service
  with persistent storage before this patch.
- The documented active staging bucket is `buildingos-staging`.
- The documented staging MinIO container is `buildingos-staging-minio`.
- The database model stores `File.bucket` and `File.objectKey`, with related
  import, document, quote, payment-proof, and receipt references.
- The repository documents the consistency model as partial: database and
  object operations are not atomic.
- The authoritative staging host is `vmi3361868`.
- The staging checkout SHA is `c4b7195ab35d40a6481f34ad69a0ddfa7a9de488`.

### Storage locator fields

The read-only reconciliation used only repository-defined storage locators:

- `File.bucket` and `File.objectKey` are canonical object metadata.
- `ImportJob.originalObjectKey` and `ImportJob.normalizedObjectKey` are direct
  object-key fields.
- `Expense.attachmentFileKey` and `Income.attachmentFileKey` are direct
  object-key fields; no non-null rows were present in this inventory.

The following File-ID/document relations were counted separately and were not
added as duplicate object locators: `Tenant.logoFileId`, `Document.fileId`,
`Quote.fileId`, `Payment.proofFileId`, and `Payment.receiptDocumentId`. They
resolve through the canonical `File` records.

Direct locator row counts by model and column:

| Model.column | Rows | Active bucket | Legacy bucket |
| --- | ---: | ---: | ---: |
| `File.bucket/objectKey` | 34 | 28 | 6 |
| `ImportJob.originalObjectKey` | 7 | 7 | 0 |
| `ImportJob.normalizedObjectKey` | 5 | 5 | 0 |
| `Expense.attachmentFileKey` | 0 | 0 | 0 |
| `Income.attachmentFileKey` | 0 | 0 | 0 |
| **Total direct locator rows** | **46** | **40** | **6** |

Indirect File/document relation counts, excluded from the 46-row locator
total to avoid counting the same object twice, were: `Tenant.logoFileId` 0,
`Document.fileId` 30, `Quote.fileId` 0, `Payment.proofFileId` 21, and
`Payment.receiptDocumentId` 13.

### Remote read-only runtime observations

- Hostname is `vmi3361868` and the verified staging checkout path exists.
- The staging Compose project is `buildingos-staging`.
- `buildingos-staging-api`, `buildingos-staging-web`,
  `buildingos-staging-postgres`, `buildingos-staging-minio`,
  `buildingos-staging-redis`, and `buildingos-staging-mailpit` are running and
  healthy.
- Read-only HTTP checks returned 200 for the staging API health endpoint, web
  root, and MinIO health endpoint.
- The active application bucket is `buildingos-staging`; it is the only bucket
  returned by the read-only bucket listing.
- The bucket versioning query reported no enabled versioning status.

### Inventory classification

| Item | Current verified value | Classification |
| --- | --- | --- |
| Stored object count | 46 | Active bucket recursive listing |
| Total bytes | 2,304,956 | Sum of object metadata sizes |
| Database/storage reference row count | 46 | 34 `File` rows plus 12 `ImportJob` key rows |
| Unique referenced object count | 46 | Unique bucket/key pairs across locator rows |
| Valid referenced object count | 40 | Unique active-bucket objects present |
| Missing referenced object count | 6 | All six are legacy-bucket references |
| Active-bucket missing references | 0 | No active-bucket locator lacked an object |
| Orphan stored object count | 6 | Active-bucket objects with no locator row |
| Legacy reference count | 6 | `File` rows targeting non-active bucket names |
| Malformed/invalid key count | 0 | No malformed locator identified |

Reference rows and unique objects are intentionally distinct. The 46 locator
rows resolve to 46 unique bucket/key pairs because no duplicate locator pair
was found. The 40 active-bucket references are all valid; the six remaining
references target legacy bucket names. The six active-bucket orphans were not
deleted or otherwise modified.

### Safe object metadata aggregates

No object names or bodies were emitted. Safe key-family counts are:

| Category | Count |
| --- | ---: |
| Pilot-data-pack seed objects | 3 |
| Payment evidence | 13 |
| Generated receipts | 17 |
| Other tenant/application objects | 13 |

Content-Type distribution from read-only object metadata:

| Content-Type | Count |
| --- | ---: |
| `application/pdf` | 26 |
| `application/json` | 5 |
| `application/octet-stream` | 6 |
| `image/png` | 4 |
| `text/plain; charset=utf-8` | 3 |
| `text/plain` | 1 |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 1 |

### Missing-reference classification

There are no active-bucket missing references and no malformed keys. All six
missing reference rows are `File` records whose bucket value is a legacy bucket
name; the active bucket listing contains only `buildingos-staging`. No row was
rewritten. Disposition is `REPAIR_REQUIRED_LATER`: investigate the historical
source and resolve the six legacy references in a separately approved step.

### Orphan classification

Six active-bucket objects have no current direct locator row. The aggregate
metadata indicates pilot seed data and application-generated/payment-related
objects are present; orphan status alone is not sufficient to establish
disposability. Disposition is `PRESERVE`; they remain untouched pending an
explicit later decision.

### Data significance and migration classification

Meaningful application data is present: 13 payment-evidence objects, 17
generated receipts, and 13 other tenant/application objects. Three objects are
identified by repository semantics as pilot-data-pack seed objects. Existing
staging data should therefore remain available after a storage backend
cutover.

The current classification is `REQUIRED_DATA_MIGRATION`. This is based on
verified current metadata and database correlation, not merely on the
existence of objects.

### Recommended migration scope

Use `COPY, VERIFY, SWITCH` and preserve the old MinIO source for rollback. The
recommended scope is all 46 objects in the current active bucket, rather than
only the 40 currently referenced objects. The dataset is small, copying all
objects avoids silently discarding six potentially meaningful or historical
objects and avoids combining migration with orphan cleanup. Preserve object
keys, Content-Type, and available metadata; verify SHA-256 and byte totals;
make the copy idempotent and resumable; and never delete source or target
objects automatically.

The six legacy-bucket references require a separate disposition and must not
be silently rewritten. They are not active-bucket missing references. Any
future copy must retain the old MinIO volume and support retry/resume by exact
source bucket/key identity.

## Gate 1: Provider Readiness

Gate 1 is `COMPLETE` as a final specification for approval preparation, but
provider execution is not authorized in this slice. The future target is a
dedicated private Contabo Object Storage bucket named `buildingos-staging`,
using the provider's HTTPS S3 endpoint format
`https://<contabo-region>.contabostorage.com`, confirmed provider region, and
path-style addressing.

Known requirements:

- a dedicated private staging bucket;
- ACL/policy equivalent to `private`, with anonymous reads and listing denied;
- path-style addressing enabled;
- `PUT` for direct browser uploads, with `GET` and `HEAD` retained for
  compatible reads/stat flows;
- `Content-Type` as the required browser request header;
- exact staging CORS origin:
  `https://buildingos-staging.31-220-98-21.sslip.io`;
- the accepted Contabo wildcard response recorded as a provider exception;
- no lifecycle expiration for application objects or preserved orphans;
- provider-managed SSE at rest where supported; and
- exact object-key preservation for all 46 active-bucket objects.

Manual provider inputs are the exact endpoint host, Contabo signing region,
bucket availability/creation approval, private-policy confirmation, versioning
capability, lifecycle capability, SSE mode, and provider-side CORS application.
Versioning is recommended for the target if supported; the current MinIO
source reported no enabled versioning status.

## Gate 2: Configuration Patch

The staging Compose patch is `PASS` for static review and is
configuration-only. It:

- replaces the hardcoded local `S3_ENDPOINT` with injected `S3_ENDPOINT`;
- replaces MinIO-root mappings with injected `S3_ACCESS_KEY` and
  `S3_SECRET_KEY`;
- injects `S3_FORCE_PATH_STYLE` instead of hardcoding it;
- removes the staging API dependency on local MinIO;
- removes staging-only local MinIO/bootstrap services and their volume; and
- leaves development and production Compose unchanged.

The API's existing configuration schema and storage service already support
this contract, so application code remains unchanged. Static validation is
required before rollout; this preparation performed no runtime change. The
current remote staging MinIO topology is the pre-cutover source state, so its
presence does not contradict the patch's intended future external-storage
topology.

`S3_PUBLIC_BASE_URL` is required: the API schema requires a valid URL, staging
Compose requires it, and the storage service uses it for the presign client.
The service fallback to `S3_ENDPOINT` is not a valid staging omission because
schema and Compose validation fail closed.

## Gate 3: Secret Contract

The Gate 3 contract is `COMPLETE` for approval preparation. Required protected
inputs are `S3_ENDPOINT`, `S3_REGION`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`,
`S3_PUBLIC_BASE_URL`, and
the separately required `WEB_ORIGIN`. Only the access key and secret key are
secrets. The exact endpoint, region, bucket approval, public base URL, and
provider policy/CORS confirmation remain manual inputs; path style `true`, the
proposed bucket name, and the current web origin are known.

Only the access key and secret key are secrets. All values must be injected by
the protected staging environment mechanism and must not appear in Git,
evidence, logs, shell history, or command output. The bucket must be approved
before any provider-side creation or migration.

## Decision

Gate 0 is `PASS` for read-only inventory. Gates 1-3 are prepared for final
approval review, but provider creation, secret installation, migration approval,
and rollout execution are not authorized. Orphan objects must not be deleted
and legacy references must not be altered until a separately approved plan
exists.
