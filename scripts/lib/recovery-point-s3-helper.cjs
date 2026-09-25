/* S3_FENCE_HELPER_PROTOCOL_V2: stdin-only trusted control-tree helper for the API image. */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const Minio = require('minio');

const REQUIRED_METHODS = [
  'getBucketPolicy', 'setBucketPolicy', 'presignedPutObject',
  'putObject', 'removeObject', 'getObject', 'statObject', 'listObjects',
];
const PRESIGNED_PUT_EXPIRY_SECONDS = 86_400;
const INTERNAL_ERROR_CODES = new Set([
  'S3_FENCE_BUCKET_MISMATCH',
  'S3_FENCE_CONFIGURATION_INVALID',
  'S3_FENCE_OBJECT_SIZE_MISMATCH',
  'S3_FENCE_OWNERSHIP_MISMATCH',
  'S3_FENCE_REQUEST_INVALID',
  'S3_FENCE_VERSION_ID_INVALID',
  'S3_FENCE_VERSION_MISMATCH',
]);

function fail(code) { return { ok: false, error: code }; }
function errorCode(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  if (typeof code === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(code)) return code;
  const message = error instanceof Error ? error.message : undefined;
  return typeof message === 'string' && INTERNAL_ERROR_CODES.has(message) ? message : 'S3_FENCE_SDK_ERROR';
}
function configuration() {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const accessKey = process.env.S3_ACCESS_KEY?.trim();
  const secretKey = process.env.S3_SECRET_KEY?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const region = process.env.S3_REGION?.trim() || 'us-east-1';
  if (!endpoint || !accessKey || !secretKey || !bucket) throw new Error('S3_FENCE_CONFIGURATION_INVALID');
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('S3_FENCE_CONFIGURATION_INVALID'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('S3_FENCE_CONFIGURATION_INVALID');
  return {
    bucket,
    client: new Minio.Client({
      endPoint: url.hostname,
      port: url.port ? Number.parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80,
      useSSL: url.protocol === 'https:', accessKey, secretKey, region,
      pathStyle: process.env.S3_FORCE_PATH_STYLE?.trim() === 'true',
    }),
  };
}
function assertKey(key) {
  if (typeof key !== 'string' || !/^buildingos-fence-probe-[a-f0-9]{32}$/.test(key)) throw new Error('S3_FENCE_REQUEST_INVALID');
}
function versionId(value) {
  if (value === null) return null;
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error('S3_FENCE_VERSION_ID_INVALID');
}
function validateRequestedVersionId(value) {
  if (value === null) return null;
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error('S3_FENCE_REQUEST_INVALID');
}
function isObjectAbsenceError(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return code === 'NotFound' || code === 'NoSuchKey';
}
function statOptions(id) { return id === null ? undefined : { versionId: id }; }
function probeBody(key) { return Buffer.from(`BuildingOS recovery-point fence probe: ${key}\n`); }
function readBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks)));
  });
}
async function assertOwnedObject(client, bucket, key, id) {
  const stat = await client.statObject(bucket, key, statOptions(id));
  if (versionId(stat.versionId) !== id) throw new Error('S3_FENCE_OWNERSHIP_MISMATCH');
  const body = await readBuffer(await client.getObject(bucket, key, statOptions(id)));
  if (!body.equals(probeBody(key))) throw new Error('S3_FENCE_OWNERSHIP_MISMATCH');
}
function drain(stream) {
  return new Promise((resolve, reject) => { stream.on('data', () => undefined); stream.once('error', reject); stream.once('end', resolve); });
}
function listContains(stream, key) {
  return new Promise((resolve, reject) => {
    let found = false;
    stream.on('data', (item) => { if (item && item.name === key) found = true; });
    stream.once('error', reject); stream.once('end', () => resolve(found));
  });
}
function objectOutputRoot() {
  const outputRoot = process.env.S3_FENCE_OBJECT_STAGING_ROOT;
  if (typeof outputRoot !== 'string' || outputRoot.includes('\0') || !path.isAbsolute(outputRoot)) {
    throw new Error('S3_FENCE_CONFIGURATION_INVALID');
  }
  return path.resolve(outputRoot);
}
function objectGetRequest(request) {
  const requestedVersionId = request.versionId === undefined ? null : validateRequestedVersionId(request.versionId);
  if (typeof request.bucket !== 'string' || request.bucket.length === 0
    || typeof request.key !== 'string' || request.key.length === 0
    || (requestedVersionId !== null && typeof requestedVersionId !== 'string')
    || !Number.isSafeInteger(request.expectedBytes) || request.expectedBytes < 0
    || typeof request.outputBasename !== 'string' || !/^(?!\.{1,2}$)[A-Za-z0-9.][A-Za-z0-9._-]{0,127}$/.test(request.outputBasename)
    || path.basename(request.outputBasename) !== request.outputBasename) {
    throw new Error('S3_FENCE_REQUEST_INVALID');
  }
  return { requestedVersionId, outputBasename: request.outputBasename };
}
async function writeObject(stream, outputRoot, outputBasename) {
  const outputPath = path.join(outputRoot, outputBasename);
  let fd;
  let created = false;
  try {
    fd = fs.openSync(outputPath, 'wx', 0o600);
    created = true;
    fs.fchmodSync(fd, 0o600);
    const digest = crypto.createHash('sha256');
    let bytes = 0;
    stream.on('data', (chunk) => {
      const body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += body.length;
      digest.update(body);
    });
    await pipeline(stream, fs.createWriteStream(null, { fd, autoClose: true }));
    fd = undefined;
    return { bytes, sha256: digest.digest('hex'), outputPath };
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best-effort close before owned cleanup */ }
    }
    if (created) {
      try { fs.unlinkSync(outputPath); } catch { /* only the exclusively-created file is eligible */ }
    }
    throw error;
  }
}
async function objectGet(client, configuredBucket, request) {
  const { requestedVersionId, outputBasename } = objectGetRequest(request);
  if (request.bucket !== configuredBucket) throw new Error('S3_FENCE_BUCKET_MISMATCH');
  const stat = await client.statObject(configuredBucket, request.key, statOptions(requestedVersionId));
  const observedVersionId = versionId(stat.versionId);
  if (requestedVersionId !== null && observedVersionId !== requestedVersionId) throw new Error('S3_FENCE_VERSION_MISMATCH');
  const result = await writeObject(await client.getObject(configuredBucket, request.key, statOptions(observedVersionId)), objectOutputRoot(), outputBasename);
  if (result.bytes !== request.expectedBytes) {
    try { fs.unlinkSync(result.outputPath); } catch { /* the helper owns this exclusive output */ }
    throw new Error('S3_FENCE_OBJECT_SIZE_MISMATCH');
  }
  return { ok: true, bucket: configuredBucket, bytes: result.bytes, sha256: result.sha256, versionId: observedVersionId };
}

async function main(request) {
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.action !== 'string') throw new Error('S3_FENCE_REQUEST_INVALID');
    const { client, bucket } = configuration();
    if (request.action === 'preflight') {
      const version = require('minio/package.json').version;
      const missing = REQUIRED_METHODS.filter((method) => typeof client[method] !== 'function');
      return { ok: version === '8.0.7' && missing.length === 0, version, missing };
    }
    if (request.action === 'object-get') return await objectGet(client, bucket, request);
    if (request.action === 'policy-get') {
      try {
        const policy = await client.getBucketPolicy(bucket);
        if (typeof policy !== 'string') return fail('S3_FENCE_POLICY_RESPONSE_INVALID');
        JSON.parse(policy);
        return { ok: true, state: 'present', bucket, policyBase64: Buffer.from(policy, 'utf8').toString('base64') };
      } catch (error) {
        return errorCode(error) === 'NoSuchBucketPolicy' ? { ok: true, state: 'absent', bucket } : fail(errorCode(error));
      }
    }
    if (request.action === 'policy-set') {
      if (typeof request.policy !== 'string') throw new Error('S3_FENCE_REQUEST_INVALID');
      JSON.parse(request.policy);
      await client.setBucketPolicy(bucket, request.policy);
      return { ok: true };
    }
    if (request.action === 'policy-remove') { await client.setBucketPolicy(bucket, ''); return { ok: true }; }
    if (request.action === 'verify-absent') {
      if (request.bucket !== bucket || typeof request.bucket !== 'string') throw new Error('S3_FENCE_BUCKET_MISMATCH');
      assertKey(request.key);
      const id = validateRequestedVersionId(request.versionId);
      if (id === null) throw new Error('S3_FENCE_REQUEST_INVALID');
      try {
        const stat = await client.statObject(bucket, request.key, { versionId: id });
        if (versionId(stat.versionId) !== id) return fail('S3_FENCE_VERSION_MISMATCH');
        return fail('S3_FENCE_OBJECT_PRESENT');
      } catch (error) {
        if (isObjectAbsenceError(error)) return { ok: true, state: 'absent', bucket, key: request.key, versionId: id };
        throw error;
      }
    }
    assertKey(request.key);
    if (request.action === 'presigned-put') {
      if (request.expirySeconds !== PRESIGNED_PUT_EXPIRY_SECONDS) throw new Error('S3_FENCE_REQUEST_INVALID');
      return { ok: true, url: await client.presignedPutObject(bucket, request.key, PRESIGNED_PUT_EXPIRY_SECONDS) };
    }
    if (request.action === 'put') {
      await client.putObject(bucket, request.key, probeBody(request.key));
      const stat = await client.statObject(bucket, request.key);
      return { ok: true, versionId: versionId(stat.versionId) };
    }
    if (request.action === 'get') { const id = validateRequestedVersionId(request.versionId ?? null); await drain(await client.getObject(bucket, request.key, statOptions(id))); return { ok: true }; }
    if (request.action === 'head') {
      const id = validateRequestedVersionId(request.versionId ?? null);
      const stat = await client.statObject(bucket, request.key, statOptions(id));
      return { ok: true, versionId: versionId(stat.versionId) };
    }
    if (request.action === 'list') return await listContains(client.listObjects(bucket, request.key, false), request.key) ? { ok: true } : fail('S3_FENCE_LIST_KEY_MISSING');
    if (request.action === 'verify-owned' || request.action === 'remove-owned') {
      if (request.bucket !== bucket || typeof request.bucket !== 'string') throw new Error('S3_FENCE_BUCKET_MISMATCH');
      const id = validateRequestedVersionId(request.versionId ?? null);
      await assertOwnedObject(client, bucket, request.key, id);
      if (request.action === 'remove-owned') await client.removeObject(bucket, request.key, statOptions(id));
      return { ok: true };
    }
    throw new Error('S3_FENCE_REQUEST_INVALID');
  } catch (error) { return fail(errorCode(error)); }
}
