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

const isExactVersionAbsent = (error) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const { code } = error;
  return code === 'NoSuchKey' || code === 'NoSuchVersion';
};

const errorDescription = (error) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

const verifyExactVersionAbsent = async (client, manifestPath, manifest) => {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (true) {
    try {
      await client.statObject(manifest.bucket, manifest.objectKey, { versionId: manifest.objectVersionId });
    } catch (error) {
      if (isExactVersionAbsent(error)) {
        console.log(`EXACT_VERSION_ABSENT manifest=${manifestPath}`);
        return;
      }
      throw new Error(`RECEIPT_STORAGE_QUERY_ERROR manifest=${manifestPath} reason=${errorDescription(error)}`);
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
  for (const manifest of manifests) {
    await verifyExactVersionAbsent(client, manifest.manifestPath, manifest.value);
  }

  console.log(`RECEIPT_STORAGE_CLEANUP_OK manifests=${manifests.length}`);
};

main().catch((error) => {
  console.error(errorDescription(error));
  process.exitCode = 1;
});
