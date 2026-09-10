const test = require('node:test');
const assert = require('node:assert/strict');
const { isExactVersionAbsent, validateManifest, verifyExactVersionAbsent } = require('../verify-receipt-storage-cleanup');

const manifest = { bucket: 'test-bucket', objectKey: 'tenant/payment/receipt.pdf', objectVersionId: 'exact-version' };
const absent = [
  { code: 'NoSuchKey', message: 'missing' },
  { code: 'NoSuchVersion', message: 'missing version' },
  { name: 'S3Error', $metadata: { httpStatusCode: 404 }, message: 'Not Found' },
];
for (const error of absent) test(`exact absence: ${error.code ?? 'structured 404'}`, () => assert.equal(isExactVersionAbsent(error, true, 'exact-version'), true));
for (const [name, error] of Object.entries({ messageOnly: new Error('Not Found'), forbidden: { $metadata: { httpStatusCode: 403 }, message: 'Forbidden' }, server: { $metadata: { httpStatusCode: 500 }, message: 'Internal Error' }, network: new Error('connect ECONNREFUSED') })) test(`query failure: ${name}`, () => assert.equal(isExactVersionAbsent(error, true, 'exact-version'), false));
test('exact version present fails after polling', async () => {
  await assert.rejects(verifyExactVersionAbsent({ bucketExists: async () => true, statObject: async () => ({}) }, 'manifest.json', manifest), /EXACT_VERSION_STILL_PRESENT/);
});
test('missing version id fails closed', () => assert.throws(() => validateManifest('manifest.json', { ...manifest, objectVersionId: '' }), /invalid-objectVersionId/));
test('stat request uses the exact version id', async () => {
  let args;
  await verifyExactVersionAbsent({ bucketExists: async () => true, statObject: async (...received) => { args = received; throw { code: 'NoSuchVersion' }; } }, 'manifest.json', manifest);
  assert.deepEqual(args, ['test-bucket', 'tenant/payment/receipt.pdf', { versionId: 'exact-version' }]);
});

test('MinIO NotFound needs bucket confirmation and version id', () => {
 const error={name:'S3Error',code:'NotFound',message:'Not Found'};
 assert.equal(isExactVersionAbsent(error,true,'exact-version'),true);
 assert.equal(isExactVersionAbsent(error,false,'exact-version'),false);
 assert.equal(isExactVersionAbsent(error,true,''),false);
});
test('bucket absence fails closed', async () => { await assert.rejects(verifyExactVersionAbsent({bucketExists:async()=>false,statObject:async()=>({})},'manifest.json',manifest),/RECEIPT_STORAGE_QUERY_ERROR/); });
