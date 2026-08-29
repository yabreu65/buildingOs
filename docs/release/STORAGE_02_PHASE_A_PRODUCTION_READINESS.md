# STORAGE_02 Phase A Production Readiness

## Overall Status

`NOT READY / BLOCKED`.

This is a read-only production inventory and readiness assessment. No production
object, database row, bucket, credential, container, network, environment file,
or repository checkout was modified.

Evidence was collected on 2026-08-29 in the protected temporary directory
`/tmp/storage02-prod-inventory-20260829` on the production host. Object names,
object bodies, credentials, and presigned URLs were not emitted in the report.

## Gate 0: Runtime and Provider Inventory

### Production runtime

- Hostname: `vmi3361868`; SSH alias: `pawtech`.
- Production application image revision: `c987eacdfe5e9f5b3772d498bb1b4fd77859dfdc`.
- `buildingos-api`, `buildingos-web`, `buildingos-minio`, `pawtech-postgres`,
  and `pawtech-redis` were running and healthy with zero observed restarts.
- `pawtech_internal` is Docker-internal and contains the production API,
  MinIO, PostgreSQL, Redis, and web containers.
- `buildingos-minio` is also attached to `pawtech_public` and has an active
  Traefik HTTPS route.
- The production checkout is dirty and must not be cleaned or altered. It has
  one modified staging Compose file and three untracked staging-preparation
  evidence/readiness documents.

### Active storage configuration

- Endpoint: `http://buildingos-minio:9000`.
- Region: `us-east-1`.
- Bucket: `buildingos`.
- Path-style addressing: enabled.
- Presign base URL: the public HTTPS MinIO route.
- The API generates 24-hour presigned upload and download URLs.
- Access and secret credentials were confirmed present but never printed.

### Bucket inventory

| Bucket | Region | Objects | Bytes |
| --- | --- | ---: | ---: |
| `buildingos` | `us-east-1` | 2 | 2,093 |
| `buildingos-local` | `us-east-1` | 0 | 0 |
| **Total** |  | **2** | **2,093** |

Both stored objects are `application/pdf`. Size statistics are minimum 484,
maximum 1,609, average 1,046.5, and median 1,046.5 bytes. A SHA-256 object
manifest was collected for all objects.

### Bucket controls

For `buildingos`, read-only S3 control queries returned ACL, policy, and
versioning configuration. No CORS, lifecycle, or encryption configuration was
returned. The policy-status API reported `IsPublic=false`.

For `buildingos-local`, read-only queries returned ACL and versioning
configuration. No policy, CORS, lifecycle, or encryption configuration was
returned. The policy-status API reported `IsPublic=false`.

## Gate 1: Database Reconciliation

### Canonical File references

The production database contains 9 `File` rows across 2 tenants:

| Classification | File rows | Documents | Payment proofs | Quotes |
| --- | ---: | ---: | ---: | ---: |
| Valid object in the recorded bucket | 2 | 2 | 1 | 0 |
| Missing bucket | 7 | 7 | 0 | 0 |
| Missing object | 0 | 0 | 0 | 0 |
| Malformed | 0 | 0 | 0 | 0 |

The 7 missing-bucket rows target `demo-documents` (5 rows) and `documents` (2
rows). Neither bucket exists in the production MinIO bucket listing. These are
7 business-critical document references and must not be silently rewritten,
deleted, or treated as disposable migration orphans.

The 2 active `buildingos` objects are referenced by the 2 active-bucket `File`
rows. The single `Payment.receiptDocumentId` resolves to an active-bucket file;
there are no missing payment receipt references.

### Additional storage locators

| Model or field | Non-null rows |
| --- | ---: |
| `ImportJob.originalObjectKey` | 0 |
| `ImportJob.normalizedObjectKey` | 0 |
| `Expense.attachmentFileKey` | 0 |
| `Income.attachmentFileKey` | 0 |
| `Tenant.logoFileId` | 0 |
| `Payment.receiptDocumentId` | 1 |

`Document.fileId`, `Quote.fileId`, and `Payment.proofFileId` were reconciled
through their canonical `File` rows rather than counted as duplicate object
locators.

### Orphans and missing data

- Active-bucket orphan objects: 0.
- Active-bucket missing references: 0.
- Missing legacy buckets: 2 bucket names, affecting 7 document references.
- No source object was deleted or changed.

Gate 1 is blocked by the 7 missing legacy-bucket document references. Their
historical source and disposition must be established before migration scope
can be approved.

## Gate 2: Public Exposure and Network Barrier

Gate 2 is blocked and has a high-severity finding:

- Production MinIO is attached to `pawtech_public`.
- Traefik exposes `buildingos-minio` on HTTPS.
- An unsigned anonymous `ListObjectsV2` request succeeded and returned 2
  objects totaling 2,093 bytes.
- An unsigned `HEAD` request for an object succeeded.
- The route health endpoint returned HTTP 200.

The policy-status API reporting `IsPublic=false` does not eliminate the
observed exposure. The route and MinIO behavior require investigation and
remediation. The target design must keep storage private, deny anonymous
listing/reads, and use an explicitly approved public presign/download strategy
only if required by the application contract.

## Gate 3: Provider and Application Cutover Readiness

Gate 3 is not ready for approval:

- No dedicated Contabo production bucket or endpoint was provisioned or
  verified in this read-only phase.
- Production Compose still owns local MinIO, its persistent volume, bootstrap
  service, public route, and API health dependency.
- The deployment script has exact-SHA, backup, migration, health, and rollback
  compatibility checks, but production preflight would reject the currently
  dirty checkout.
- The future production patch must replace local MinIO dependency/configuration
  with the approved external provider contract and preserve a rollback path.
- The current public presign design must be explicitly reviewed before choosing
  the external provider endpoint and CORS policy.

## Decision

Do not authorize production migration, cutover, MinIO detachment, legacy-data
cleanup, or bucket deletion from this assessment.

Required follow-up:

1. Investigate and disposition the 7 missing-bucket document references using
   approved backups or historical storage sources.
2. Remediate the anonymous MinIO listing/object-metadata exposure under an
   explicitly approved operational change.
3. Define and verify the dedicated private production object-storage target,
   including region, encryption, versioning, lifecycle, CORS, and access
   policy.
4. Prepare the production Compose, protected environment contract, presign
   behavior, migration tooling, and rollback evidence locally.
5. Rerun the full read-only inventory and approve `COPY, VERIFY, SWITCH` only
   after the data and network blockers are closed.

## Dated Follow-up (2026-08-29)

The historical Phase A blockers were resolved by the subsequent authorized
operations:

- B2 restored the `buildingos` bucket to private access. Anonymous LIST, HEAD,
  and GET are denied while signed access remains functional.
- B4 removed exactly the seven approved demo/seed `Document` rows and their
  seven associated legacy `File` rows. Two active Document/File pairs and two
  active MinIO objects totaling 2,093 bytes remain intact.
- B5 preserved the unique dirty checkout source change and operational evidence,
  then left the production checkout clean at the runtime SHA without deployment.
- B5R refreshed the production remote-tracking `origin/main` reference to the
  authoritative GitHub main commit. The preserved staging Compose change was
  confirmed semantically superseded by current main.

This document remains a historical read-only readiness assessment. Phase C
prepares the repository for a future external-storage cutover; it does not
provision Contabo, copy production objects, change production, or authorize
deployment.
