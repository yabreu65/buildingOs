# STORAGE_02 Phase C Production External Storage Preparation

## Scope and Decision

Phase C is local repository preparation for a future production external
object-storage cutover. It does not provision Contabo, create credentials,
copy production objects, mutate production, modify staging, or deploy.

Authoritative base: `origin/main` at `883b3a60d6b8727703f563ec3f7c4e1c40d50da5`.
Production remains on MinIO at runtime SHA `c987eacd...` until a separate exact
SHA deployment is explicitly authorized.

The target application storage contract is provider-neutral and consists of:

`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`,
`S3_FORCE_PATH_STYLE`, and `S3_PUBLIC_BASE_URL`.

The API receives these values from the protected production environment file.
They are not hardcoded to Contabo, MinIO, a bucket, or credentials in the
application Compose definition.

## Production Compose Topology

The target production Compose definition owns only the application services
and migration service. It no longer owns `buildingos-minio`,
`buildingos-minio-init`, the MinIO Traefik route, or the MinIO named volume.
The API no longer declares a MinIO dependency.

This is a definition change only. It does not remove, recreate, stop, detach,
or delete the existing production `buildingos-minio` container or
`buildingos_buildingos_miniodata` volume. Deployments recreate only
`buildingos-api` and `buildingos-web`; they do not use `docker compose down`,
`--remove-orphans`, or volume/container deletion commands.

## Storage States

### State A: MinIO to MinIO

The target runtime remains MinIO. The guard requires the legacy MinIO container
to exist, run healthily, and remain attached to both `pawtech_internal` and
`pawtech_public`. No cutover confirmation is required. Public attachment is
required because the current browser presigned URL flow uses the public MinIO
route.

### State B: MinIO to external S3

The target endpoint must be non-local S3-compatible storage and all seven target
settings must be present. The guard requires exact confirmation
`STORAGE_CUTOVER_CONFIRMATION=STORAGE_02_CONTABO`, stopped API and web
containers, a running and healthy legacy MinIO container, MinIO attached to
`pawtech_internal`, and MinIO detached from `pawtech_public`.

The target Compose definition must not contain a legacy MinIO service. The
guard fails closed if any barrier is missing. The operational cutover sequence
is:

`COPY -> VERIFY -> QUIESCE -> PUBLIC BARRIER -> FINAL DELTA -> VERIFY -> SWITCH -> DEPLOY -> ACCEPT`

### State C: external S3 to external S3

External storage remains authoritative. The guard requires the target contract
but does not require legacy MinIO, its health, its networks, or cutover
confirmation. Ordinary future deployments therefore continue after the legacy
MinIO retention window ends.

### External S3 to MinIO rollback

Rollback is never treated as a normal deployment. It requires exact
`STORAGE_CUTOVER_CONFIRMATION=STORAGE_02_MINIO_ROLLBACK`, a stopped API,
healthy legacy MinIO, and both `pawtech_internal` and `pawtech_public` attached.
The target endpoint must be an internal MinIO endpoint.

The guard proves infrastructure topology only. It cannot prove reconciliation
of writes made during the external-storage window. Operators must reconcile
those writes before restoring the MinIO environment and deploying the approved
rollback SHA:

`RECONCILE NEW EXTERNAL WRITES -> RESTORE ENV -> RESTORE MINIO PUBLIC NETWORK -> DEPLOY APPROVED SHA -> VERIFY`

Any current or target provider classified as `UNKNOWN` fails closed. Provider
classification uses endpoint semantics, never the bucket name or credentials.
The env parser reads required values without sourcing arbitrary shell code,
rejects duplicate storage keys, and never prints secret values.

## Deployment Safety

`scripts/production-storage-cutover-guard.sh` runs before backup, build,
migrations, or application recreation. A failed guard performs no build,
migration, or container mutation. Existing exact-SHA, backup, migration
baseline/manifest, rollback compatibility, image revision, health, and critical
log validations remain required.

The production workflow remains `workflow_dispatch` only, retains exact SHA,
approved SHA, and expected-current-SHA inputs, and packages the guard as an
explicit trusted deployment-control file. It does not create an automatic
production deployment or merge this PR.

## Storage-01 Lessons Carried Forward

- SHA-256, not ETag, is the integrity authority.
- AWS checksum behavior must remain safe and `aws-chunked` metadata must not be
  introduced.
- MIME types require exact verification; only narrow `text/plain` charset
  normalization is acceptable.
- API quiescence alone is insufficient for stale presigned URLs.
- Bucket policy alone is not the stale-presigned-URL barrier.
- Traefik behavior is not relied upon as the sole barrier.
- Docker public-network isolation is the proven stale-presign barrier.
- Existing pre-cutover objects require explicit acceptance before switching.
- A new post-cutover object must be proven Contabo YES and MinIO NO.
- Rollback must reconcile external-window writes before restoring MinIO.

## Contabo Boundary

No production Contabo bucket, access key, secret key, CORS rule, versioning
configuration, or object copy is created in Phase C. Documentation-only
candidate values are:

- Endpoint: `https://usc1.contabostorage.com`
- Region: `default`
- Bucket: `buildingos-production`

These are not verified production values. Staging buckets and staging
credentials must never be reused.

## Validation and Release Boundary

Focused guard tests cover MinIO-to-MinIO, MinIO-to-external, external-to-
external, external-to-MinIO rollback, unknown providers, missing/duplicate
settings, topology barriers, Compose ownership, and secret non-disclosure.
Controlled dummy env files validate both MinIO and external Compose rendering.

The PR must be reviewed and pass CI before any future production deployment.
This Phase C change must not be merged or deployed without separate
authorization.
