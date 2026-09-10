#!/usr/bin/env node

const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const Minio = require('minio');

const MANIFEST_DIRECTORY = path.resolve(__dirname, '../../web/test-results/receipt-cleanup-verification');
const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 10_000;
const MANIFEST_FILE_NAME = /^[A-Za-z0-9_-]+\.json$/;
const MANIFEST_FIELDS = ['bucket', 'objectKey', 'objectVersionId'];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isExactVersionAbsent = (error, bucketConfirmed, versionId) => {
  const { code, httpStatusCode, name } = errorDetails(error);
  if (!bucketConfirmed || typeof versionId !== 'string' || versionId.trim().length === 0) return false;
  return code === 'NoSuchKey' || code === 'NoSuchVersion' || httpStatusCode === 404 || (name === 'S3Error' && code === 'NotFound');
};

const errorDetails = (error) => {
  if (!error || typeof error !== 'object') {
    return { name: typeof error, code: undefined, httpStatusCode: undefined, message: String(error) };
  }

  const candidate = error;
  const metadata = candidate.$metadata;
  return {
    name: typeof candidate.name === 'string' ? candidate.name : undefined,
    code: typeof candidate.code === 'string' ? candidate.code : typeof candidate.Code === 'string' ? candidate.Code : undefined,
    httpStatusCode: metadata && typeof metadata === 'object' && typeof metadata.httpStatusCode === 'number'
      ? metadata.httpStatusCode
      : typeof candidate.statusCode === 'number' ? candidate.statusCode : undefined,
    message: candidate instanceof Error ? candidate.message : String(error),
  };
};

const errorDescription = (error) => errorDetails(error).message;

const errorDiagnostic = (error) => {
  const { name, code, httpStatusCode, message } = errorDetails(error);
  return `name=${name ?? 'unknown'} code=${code ?? 'unknown'} httpStatusCode=${httpStatusCode ?? 'unknown'} message=${JSON.stringify(message)}`;
};

const validateManifest = (manifestPath, parsed) => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`RECEIPT_CLEANUP_MANIFEST_INVALID file=${manifestPath} reason=not-an-object`);
  }

  const fields = Object.keys(parsed).sort();
  const expectedFields = [...MANIFEST_FIELDS].sort();
  if (fields.length !== expectedFields.length || fields.some((field, index) => field !== expectedFields[index])) {
    throw new Error(`RECEIPT_CLEANUP_MANIFEST_INVALID file=${manifestPath} reason=unexpected-fields`);
  }

  for (const field of MANIFEST_FIELDS) {
    if (typeof parsed[field] !== 'string' || parsed[field].trim().length === 0) {
      throw new Error(`RECEIPT_CLEANUP_MANIFEST_INVALID file=${manifestPath} reason=invalid-${field}`);
    }
  }

  return parsed;
};

const loadManifests = async () => {
  let entries;
  try {
    entries = await readdir(MANIFEST_DIRECTORY, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return [];
    }
    throw new Error(`RECEIPT_CLEANUP_MANIFEST_READ_FAILED directory=${MANIFEST_DIRECTORY} reason=${errorDescription(error)}`);
  }

  const manifestPaths = [];
  for (const entry of entries) {
    if (!entry.isFile() || !MANIFEST_FILE_NAME.test(entry.name)) {
      throw new Error(`RECEIPT_CLEANUP_MANIFEST_INVALID file=${entry.name} reason=unexpected-directory-entry`);
    }
    manifestPaths.push(path.join(MANIFEST_DIRECTORY, entry.name));
  }

  const manifests = [];
  for (const manifestPath of manifestPaths.sort()) {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      throw new Error(`RECEIPT_CLEANUP_MANIFEST_INVALID file=${manifestPath} reason=${errorDescription(error)}`);
    }
    manifests.push({ manifestPath, value: validateManifest(manifestPath, parsed) });
  }

  return manifests;
};

const createClient = () => {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const accessKey = process.env.S3_ACCESS_KEY?.trim();
  const secretKey = process.env.S3_SECRET_KEY?.trim();

  if (!endpoint || !accessKey || !secretKey) {
    throw new Error('RECEIPT_CLEANUP_STORAGE_CONFIGURATION_INVALID');
  }

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('RECEIPT_CLEANUP_STORAGE_CONFIGURATION_INVALID');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('RECEIPT_CLEANUP_STORAGE_CONFIGURATION_INVALID');
  }

  return new Minio.Client({
    endPoint: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80,
    useSSL: url.protocol === 'https:',
    accessKey,
    secretKey,
  });
};

const verifyExactVersionAbsent = async (client, manifestPath, manifest, bucketCache = new Map()) => {
  let bucketConfirmed = bucketCache.get(manifest.bucket);
  if (bucketConfirmed === undefined) {
    try {
      bucketConfirmed = await client.bucketExists(manifest.bucket);
    } catch (error) {
      throw new Error(`RECEIPT_STORAGE_QUERY_ERROR manifest=${manifestPath} bucket-check ${errorDiagnostic(error)}`);
    }
    bucketCache.set(manifest.bucket, bucketConfirmed);
  }
  if (!bucketConfirmed) {
    throw new Error(`RECEIPT_STORAGE_QUERY_ERROR manifest=${manifestPath} bucket-check name=unknown code=NoSuchBucket httpStatusCode=unknown message="Bucket unavailable"`);
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (true) {
    try {
      await client.statObject(manifest.bucket, manifest.objectKey, { versionId: manifest.objectVersionId });
    } catch (error) {
      if (isExactVersionAbsent(error, bucketConfirmed, manifest.objectVersionId)) {
        console.log(`EXACT_VERSION_ABSENT manifest=${manifestPath}`);
        return;
      }
      throw new Error(`RECEIPT_STORAGE_QUERY_ERROR manifest=${manifestPath} ${errorDiagnostic(error)}`);
    }

    const remainingMilliseconds = deadline - Date.now();
    if (remainingMilliseconds <= 0) {
      throw new Error(`EXACT_VERSION_STILL_PRESENT manifest=${manifestPath}`);
    }
    await sleep(Math.min(POLL_INTERVAL_MS, remainingMilliseconds));
  }
};

const main = async () => {
  const manifests = await loadManifests();
  if (manifests.length === 0) {
    console.log('RECEIPT_STORAGE_CLEANUP_OK manifests=0');
    return;
  }

  const client = createClient();
  const bucketCache = new Map();
  for (const manifest of manifests) {
    await verifyExactVersionAbsent(client, manifest.manifestPath, manifest.value, bucketCache);
  }

  console.log(`RECEIPT_STORAGE_CLEANUP_OK manifests=${manifests.length}`);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(errorDescription(error));
    process.exitCode = 1;
  });
}

module.exports = { isExactVersionAbsent, validateManifest, verifyExactVersionAbsent, errorDetails };
