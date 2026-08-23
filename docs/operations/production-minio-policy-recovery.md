# Production MinIO Policy Recovery

This procedure changes only the anonymous bucket policy. It does not deploy application code, recreate containers, alter credentials, or restore data. Every execution requires a separately approved production change window. Policy restoration requires another separate approval.

## Preconditions

- Record the approved change ID, operator, bucket, MinIO alias, public S3 base URL, one existing document object key, and one existing payment-receipt object key.
- Confirm `mc`, `jq`, `sha256sum`, and `curl` are available through the approved operations environment.
- Use an already configured authenticated `mc` alias. Do not place credentials in shell history, command arguments, this document, or evidence files.
- Choose an evidence directory outside every application checkout. The examples use `/opt/pawtech/operations/buildingos/minio-policy-recovery`.
- Stop if policy capture, checksum verification, or any post-change check fails. Do not improvise a replacement policy.

Set non-secret identifiers without printing credentials:

```bash
set -Eeuo pipefail
readonly CHANGE_ID='<approved-change-id>'
readonly MC_ALIAS='<configured-production-alias>'
readonly BUCKET='<production-bucket>'
readonly PUBLIC_S3_BASE_URL='https://<production-minio-host>'
readonly EXISTING_DOCUMENT_KEY='<existing-document-object-key>'
readonly EXISTING_RECEIPT_KEY='<existing-payment-receipt-object-key>'
readonly CAPTURE_ROOT='/opt/pawtech/operations/buildingos/minio-policy-recovery'
readonly CAPTURE_DIR="$CAPTURE_ROOT/$CHANGE_ID"

umask 077
install -d -m 700 "$CAPTURE_ROOT" "$CAPTURE_DIR"
```

## 1. Capture the exact current policy

Capture the exact JSON before changing anonymous access. Keep the raw file for restoration and a canonical JSON file for review. Both files and the checksum file must remain mode `0600` outside the checkout.

```bash
mc anonymous get-json "$MC_ALIAS/$BUCKET" > "$CAPTURE_DIR/policy.exact.json"
chmod 600 "$CAPTURE_DIR/policy.exact.json"

jq -e -S . "$CAPTURE_DIR/policy.exact.json" > "$CAPTURE_DIR/policy.canonical.json"
chmod 600 "$CAPTURE_DIR/policy.canonical.json"

(
  cd "$CAPTURE_DIR"
  sha256sum policy.exact.json policy.canonical.json > policy.sha256
  chmod 600 policy.sha256
  sha256sum -c policy.sha256
)

test "$(stat -c '%a' "$CAPTURE_DIR/policy.exact.json")" = 600
test "$(stat -c '%a' "$CAPTURE_DIR/policy.canonical.json")" = 600
test "$(stat -c '%a' "$CAPTURE_DIR/policy.sha256")" = 600
```

Copy the two SHA-256 entries from `policy.sha256`, not the policy contents, into the approved change evidence. Never print or attach the captured policy unless its disclosure has been reviewed.

## 2. Remove anonymous access

Run only after capture and checksum verification pass:

```bash
mc anonymous set none "$MC_ALIAS/$BUCKET"
```

Do not use a canned or downloaded policy as rollback material. The only permitted restoration input is `policy.exact.json` captured from this bucket immediately before this change.

## 3. Verify anonymous denial

Use known existing keys. URL-encode object keys before constructing URLs. Both unauthenticated requests must return HTTP `403`; `200`, redirects to public content, and `404` are failures because they do not prove policy denial.

```bash
anonymous_document_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  "$PUBLIC_S3_BASE_URL/$BUCKET/$EXISTING_DOCUMENT_KEY")"
anonymous_receipt_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  "$PUBLIC_S3_BASE_URL/$BUCKET/$EXISTING_RECEIPT_KEY")"
test "$anonymous_document_status" = 403
test "$anonymous_receipt_status" = 403
```

Also verify the anonymous bucket endpoint returns `403`:

```bash
anonymous_bucket_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  "$PUBLIC_S3_BASE_URL/$BUCKET")"
test "$anonymous_bucket_status" = 403
```

## 4. Verify authenticated and presigned access

First prove authenticated read access without changing bucket data:

```bash
mc stat "$MC_ALIAS/$BUCKET/$EXISTING_DOCUMENT_KEY"
mc stat "$MC_ALIAS/$BUCKET/$EXISTING_RECEIPT_KEY"
mc cp "$MC_ALIAS/$BUCKET/$EXISTING_DOCUMENT_KEY" "$CAPTURE_DIR/existing-document.verify"
mc cp "$MC_ALIAS/$BUCKET/$EXISTING_RECEIPT_KEY" "$CAPTURE_DIR/existing-receipt.verify"
chmod 600 "$CAPTURE_DIR/existing-document.verify" "$CAPTURE_DIR/existing-receipt.verify"
```

Then use the production application through an approved authenticated operator account:

1. Request a presigned upload URL through the normal document-upload flow.
2. Upload a non-sensitive approved probe using that exact URL and require a successful `2xx` response.
3. Finalize the document through the normal API flow and record its document ID and object checksum.
4. Request the document's presigned download URL, download it, and verify its checksum matches the upload.
5. Request a presigned download for the pre-existing document and verify it remains readable and unchanged.
6. Request a presigned download for the pre-existing payment receipt and verify it remains readable and unchanged.
7. Confirm the application database still references both existing object keys and the new probe exactly once.
8. Remove the approved probe through the normal application flow if the change approval includes cleanup; otherwise retain it as named evidence. Never delete an existing document or receipt.

Store request IDs, HTTP statuses, document/receipt IDs, object keys, and checksums in the approved evidence location. Do not store authentication headers, cookies, credentials, or signed URL query strings.

## 5. Success criteria

The change passes only when all of the following are true:

- exact and canonical policy captures plus checksums exist outside the checkout with mode `0600`;
- anonymous bucket, existing-document, and existing-receipt requests return `403`;
- authenticated `mc` access succeeds;
- presigned upload and download succeed with matching checksums;
- the existing document and payment receipt remain downloadable through the application;
- document and receipt database references remain intact;
- no credentials or presigned URLs were copied into evidence.

## 6. Restore the captured policy under separate approval

Restoration is not automatic. Obtain a new approval that identifies the original change ID and captured checksums. Revalidate the exact captured artifacts, then restore only the exact raw JSON with `set-json`:

```bash
(
  cd "$CAPTURE_DIR"
  test "$(stat -c '%a' policy.exact.json)" = 600
  test "$(stat -c '%a' policy.canonical.json)" = 600
  test "$(stat -c '%a' policy.sha256)" = 600
  sha256sum -c policy.sha256
)

jq -e . "$CAPTURE_DIR/policy.exact.json" >/dev/null
mc anonymous set-json "$CAPTURE_DIR/policy.exact.json" "$MC_ALIAS/$BUCKET"

mc anonymous get-json "$MC_ALIAS/$BUCKET" > "$CAPTURE_DIR/policy.restored.exact.json"
chmod 600 "$CAPTURE_DIR/policy.restored.exact.json"
jq -e -S . "$CAPTURE_DIR/policy.restored.exact.json" > "$CAPTURE_DIR/policy.restored.canonical.json"
chmod 600 "$CAPTURE_DIR/policy.restored.canonical.json"
test "$(sha256sum "$CAPTURE_DIR/policy.restored.canonical.json" | cut -d ' ' -f 1)" = \
  "$(sha256sum "$CAPTURE_DIR/policy.canonical.json" | cut -d ' ' -f 1)"
```

After the canonical SHA-256 matches, repeat the authorized anonymous, authenticated, presigned, existing-document, and existing-receipt checks for the restored policy. If the canonical policies differ, stop and preserve evidence; do not apply another policy without approval.
