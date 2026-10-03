import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  captureGoldenPasswordHashes,
  captureAcceptanceBaseline,
  createAcceptanceCleanup,
  decodeRunSessionId,
  ACCEPTANCE_MUTATION_INVENTORY,
  GOLDEN_PASSWORD_USERS,
  restoreGoldenPasswordHashes,
} from "../lib/finance-staging-acceptance-cleanup.mjs";

const tenantId = "stg-golden-tenant-auto";
const buildingId = "stg-golden-building-auto";
const qaUserId = "stg-golden-user-auto-admin";
const versionId = "version-run-1";

function sameValue(actual, expected) {
  if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime();
  return actual === expected;
}

function matches(row, where) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (key === "expiresAt" && expected && typeof expected === "object" && "gt" in expected) return actual > expected.gt;
    if (expected && typeof expected === "object" && "startsWith" in expected) return typeof actual === "string" && actual.startsWith(expected.startsWith);
    return sameValue(actual, expected);
  });
}

function makeDelegate(rows = []) {
  const values = new Map(rows.map((row) => [row.id, structuredClone(row)]));
  return {
    values,
    async findFirst({ where }) {
      const row = where.id ? values.get(where.id) : [...values.values()].find((candidate) => matches(candidate, where));
      return row && matches(row, where) ? structuredClone(row) : null;
    },
    async findUnique({ where }) {
      const compound = where.tenantId_year;
      const row = compound ? [...values.values()].find((candidate) => candidate.tenantId === compound.tenantId && candidate.year === compound.year) : values.get(where.id);
      return row ? structuredClone(row) : null;
    },
    async findMany({ where }) {
      return [...values.values()].filter((row) => matches(row, where)).map((row) => structuredClone(row));
    },
    async deleteMany({ where }) {
      const row = values.get(where.id);
      if (!row || !Object.entries(where).every(([key, value]) => sameValue(row[key], value))) return { count: 0 };
      values.delete(where.id);
      return { count: 1 };
    },
    async updateMany({ where, data }) {
      const row = values.get(where.id);
      if (!row || !Object.entries(where).every(([key, value]) => sameValue(row[key], value))) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  };
}

function createFixture({ onPass = () => {} } = {}) {
  const delegates = {
    expense: makeDelegate(), income: makeDelegate(), charge: makeDelegate(), payment: makeDelegate(),
    document: makeDelegate(), file: makeDelegate(), paymentAllocation: makeDelegate(), paymentAuditLog: makeDelegate(),
    authSession: makeDelegate(), membership: makeDelegate(), user: makeDelegate(), auditLog: makeDelegate(), receiptSequence: makeDelegate(),
    tenant: makeDelegate(), building: makeDelegate(), unit: makeDelegate(),
  };
  const storageRows = new Map();
  const storageRemovals = [];
  const fileLookups = [];
  const findFile = delegates.file.findFirst.bind(delegates.file);
  delegates.file.findFirst = async ({ where }) => {
    fileLookups.push(where.id);
    if (where.id === null) throw new Error("Prisma File id cannot be null");
    return findFile({ where });
  };
  const storage = {
    async removeObject(bucket, key, options) { storageRemovals.push({ bucket, key, versionId: options.versionId }); storageRows.delete(`${bucket}\0${key}\0${options.versionId}`); },
    async getObject(bucket, key, options) {
      if (storageRows.has(`${bucket}\0${key}\0${options.versionId}`)) return new PassThrough();
      const error = new Error("version absent"); error.code = "NoSuchVersion"; throw error;
    },
  };
  delegates.receiptSequence.values.set("seq-1", { id: "seq-1", tenantId, year: 2026, lastNumber: 10, updatedAt: new Date("2026-01-01T00:00:00.000Z") });
  return {
    delegates,
    storageRows,
    storageRemovals,
    fileLookups,
    storage,
    cleanup: createAcceptanceCleanup({ prisma: delegates, storage, runId: "test-run", baseline: { passwordHashes: GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })), receiptSequence: { tenantId, year: 2026, row: { id: "seq-1", lastNumber: 10, updatedAt: "2026-01-01T00:00:00.000Z" }, nextYear: { year: 2027, row: null } } }, qaUserId, onPass }),
    add(kind, row) { delegates[kind].values.set(row.id, structuredClone(row)); },
  };
}

function addBaseResources(fixture, { withReceipt = false } = {}) {
  const rows = {
    expense: { id: "expense-1", tenantId, buildingId },
    income: { id: "income-1", tenantId, buildingId },
    charge: { id: "charge-1", tenantId, buildingId },
    payment: { id: "payment-1", tenantId, buildingId, receiptDocumentId: withReceipt ? "receipt-doc-1" : null, receiptNumber: withReceipt ? "R-GOLDEN-2026-000011" : null },
    paymentAllocation: { id: "alloc-1", tenantId, paymentId: "payment-1" },
    paymentAuditLog: { id: "payment-audit-1", tenantId, paymentId: "payment-1" },
    document: { id: "proof-doc-1", tenantId, buildingId, fileId: "proof-file-1" },
    file: { id: "proof-file-1", tenantId, bucket: "staging", objectKey: `tenant-${tenantId}/payment-proofs/run-1.pdf`, objectVersionId: versionId },
    authSession: { id: "session-run", userId: qaUserId, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    membership: { id: "membership-1", userId: qaUserId, tenantId },
    receiptSequence: { id: "seq-1", tenantId, year: 2026, lastNumber: withReceipt ? 11 : 10, updatedAt: new Date(withReceipt ? "2026-01-02T00:00:00.000Z" : "2026-01-01T00:00:00.000Z") },
    auditLog: { id: "auth-audit-1", action: "AUTH_LOGIN", actorUserId: qaUserId },
  };
  for (const [kind, row] of Object.entries(rows)) fixture.add(kind, row);
  fixture.cleanup.register("expense", rows.expense);
  fixture.cleanup.register("income", rows.income);
  fixture.cleanup.register("charge", rows.charge);
  fixture.cleanup.register("payment", rows.payment);
  fixture.cleanup.register("document", rows.document);
  fixture.cleanup.register("file", rows.file);
  fixture.cleanup.registerObject({ tenantId, bucket: rows.file.bucket, objectKey: rows.file.objectKey, objectVersionId: versionId, fileId: rows.file.id });
  fixture.cleanup.setSessionId(rows.authSession.id);
  fixture.storageRows.set(`${rows.file.bucket}\0${rows.file.objectKey}\0${versionId}`, true);
  if (withReceipt) {
    const receipt = { id: "receipt-doc-1", tenantId, buildingId, fileId: "receipt-file-1" };
    const file = { id: "receipt-file-1", tenantId, bucket: "staging", objectKey: `tenant/${tenantId}/payments/payment-1/receipts/R-GOLDEN-2026-000011.pdf`, objectVersionId: "receipt-version" };
    fixture.add("document", receipt);
    fixture.add("file", file);
    fixture.storageRows.set(`${file.bucket}\0${file.objectKey}\0${file.objectVersionId}`, true);
  }
}

test("success cleanup removes only registered mutable rows", async () => {
  const f = createFixture(); addBaseResources(f); await f.cleanup.cleanup();
  for (const kind of ["expense", "income", "charge", "payment", "paymentAllocation", "paymentAuditLog", "document", "file", "authSession"]) assert.equal(f.delegates[kind].values.size, 0);
});
test("success cleanup removes the exact uploaded storage version", async () => {
  const f = createFixture(); addBaseResources(f); await f.cleanup.cleanup(); assert.equal(f.storageRows.size, 0);
});
test("exact AuthSession is removed", async () => {
  const f = createFixture(); addBaseResources(f); await f.cleanup.cleanup(); assert.equal(f.delegates.authSession.values.has("session-run"), false);
});
test("unrelated AuthSession is preserved", async () => {
  const f = createFixture(); addBaseResources(f); f.add("authSession", { id: "session-other", userId: qaUserId, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) }); await f.cleanup.cleanup(); assert.equal(f.delegates.authSession.values.has("session-other"), true);
});
test("mutation inventory records exact durable, run-scoped, shared, and ephemeral classes", () => {
  const byResource = new Map(ACCEPTANCE_MUTATION_INVENTORY.map((entry) => [entry.resource, entry]));
  assert.deepEqual(byResource.get("AUTH_LOGIN AuditLog"), { resource: "AUTH_LOGIN AuditLog", classification: "DURABLE_AUDIT_EVIDENCE", cleanup: "NONE" });
  assert.deepEqual(byResource.get("Golden staging seed fixtures"), { resource: "Golden staging seed fixtures", classification: "DURABLE_QA_BASELINE", scope: "stg-golden-tenant-auto", cleanup: "NONE" });
  assert.deepEqual(byResource.get("AuthSession"), { resource: "AuthSession", classification: "RUN_SCOPED_DB", cleanup: "exact session id and Golden QA user" });
  assert.deepEqual(byResource.get("Finance rows and Documents/Files"), { resource: "Finance rows and Documents/Files", classification: "RUN_SCOPED_MUTABLE_DB", cleanup: "registered exact IDs with tenant/building ownership" });
  assert.deepEqual(byResource.get("S3 objects"), { resource: "S3 objects", classification: "RUN_SCOPED_STORAGE", cleanup: "exact bucket/key/version with File binding" });
  assert.deepEqual(byResource.get("ReceiptSequence"), { resource: "ReceiptSequence", classification: "SHARED_MONOTONIC_FINANCE_STATE", cleanup: "restore only on exact compare-and-set; otherwise fail closed" });
  assert.deepEqual(byResource.get("Golden user passwordHash"), { resource: "Golden user passwordHash", classification: "EPHEMERAL_GOLDEN_AUTH_MUTATION", cleanup: "exact pre-seed hash restored and verified" });
  assert.equal(byResource.size, ACCEPTANCE_MUTATION_INVENTORY.length, "inventory resource names must be unique");
});
test("AUTH_LOGIN AuditLog is durable and preserved", async () => {
  const f = createFixture(); addBaseResources(f); await f.cleanup.cleanup(); assert.equal(f.delegates.auditLog.values.has("auth-audit-1"), true);
});
test("cleanup preserves durable Golden tenant, building, unit, and membership fixtures", async () => {
  const f = createFixture();
  const fixtures = {
    tenant: { id: tenantId },
    building: { id: buildingId, tenantId },
    unit: { id: "stg-golden-unit-auto-102", buildingId },
    membership: { id: "fixture-membership", userId: qaUserId, tenantId },
  };
  for (const [kind, row] of Object.entries(fixtures)) f.add(kind, row);
  addBaseResources(f);
  await f.cleanup.cleanup();
  for (const [kind, row] of Object.entries(fixtures)) assert.deepEqual(f.delegates[kind].values.get(row.id), row);
  assert.equal(f.delegates.auditLog.values.has("auth-audit-1"), true, "cleanup must not delete AUTH_LOGIN AuditLog evidence");
});
test("AuditLog growth is excluded from mutable residue checks", async () => {
  const f = createFixture(); addBaseResources(f); f.add("auditLog", { id: "auth-audit-2", action: "AUTH_LOGIN", actorUserId: qaUserId }); await f.cleanup.cleanup(); assert.equal(f.delegates.auditLog.values.size, 2);
});
test("Golden password hashes are captured privately and atomically restored only from the exact seed hash", async () => {
  const users = makeDelegate(GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })));
  const snapshot = await captureGoldenPasswordHashes(users);
  for (const user of GOLDEN_PASSWORD_USERS) await users.updateMany({ where: user, data: { passwordHash: "exact-seed-hash" } });
  await restoreGoldenPasswordHashes({ user: users, $transaction: async (callback) => callback({ user: users }) }, snapshot, "exact-seed-hash");
  for (const user of GOLDEN_PASSWORD_USERS) assert.equal((await users.findFirst({ where: { id: user.id } })).passwordHash, `old-${user.id}`);
});

test("Golden password restoration preserves a concurrent hash mismatch and rolls back all users", async () => {
  const users = makeDelegate(GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: "exact-seed-hash" })));
  const snapshot = JSON.stringify(GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })));
  users.values.get(GOLDEN_PASSWORD_USERS[1].id).passwordHash = "concurrent-hash";
  const before = structuredClone([...users.values]);
  const database = {
    user: users,
    async $transaction(callback) {
      const draft = makeDelegate([...users.values]);
      await callback({ user: draft });
      users.values.clear();
      for (const [id, row] of draft.values) users.values.set(id, row);
    },
  };
  await assert.rejects(restoreGoldenPasswordHashes(database, snapshot, "exact-seed-hash"));
  assert.deepEqual([...users.values], before, "failed atomic restoration must preserve every user's current hash");
});

test("Golden password restoration validates every fixed ID and email before writing", async () => {
  const users = makeDelegate(GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: "exact-seed-hash" })));
  for (const [index, expected] of GOLDEN_PASSWORD_USERS.entries()) {
    for (const field of ["id", "email"]) {
      const entries = GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` }));
      entries[index] = { ...entries[index], [field]: `unexpected-${field}` };
      await assert.rejects(restoreGoldenPasswordHashes({ user: users, $transaction: async () => assert.fail("must not transact") }, JSON.stringify(entries), "exact-seed-hash"), /identity/);
    }
    assert.equal((await users.findFirst({ where: { id: expected.id } })).passwordHash, "exact-seed-hash");
  }
});
test("Golden password restoration requires the exact ephemeral seed hash", async () => {
  const users = makeDelegate(GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })));
  const snapshot = await captureGoldenPasswordHashes(users);
  await assert.rejects(restoreGoldenPasswordHashes({ user: users }, snapshot, "exact-seed-hash"), /\$transaction is not a function/);
  for (const user of GOLDEN_PASSWORD_USERS) assert.equal((await users.findFirst({ where: { id: user.id } })).passwordHash, `old-${user.id}`);
});
test("password-only baseline is rejected by acceptance cleanup", () => {
  const f = createFixture();
  const passwordHashes = GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` }));
  assert.throws(() => createAcceptanceCleanup({
    prisma: f.delegates,
    storage: f.storage,
    runId: "test-run",
    baseline: { passwordHashes },
    qaUserId,
    onPass() {},
  }), /receipt-sequence baseline is missing or invalid/);
});
test("full password-hash and ReceiptSequence baseline is accepted by acceptance cleanup", () => {
  const f = createFixture();
  assert.doesNotThrow(() => createAcceptanceCleanup({
    prisma: f.delegates,
    storage: f.storage,
    runId: "test-run",
    baseline: {
      passwordHashes: GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })),
      receiptSequence: { tenantId, year: 2026, row: { id: "seq-1", lastNumber: 7, updatedAt: "2026-01-01T00:00:00.000Z" }, nextYear: { year: 2027, row: null } },
    },
    qaUserId,
    onPass() {},
  }));
});
test("default acceptance baseline uses the local calendar year across a UTC year boundary", async () => {
  const f = createFixture();
  for (const user of GOLDEN_PASSWORD_USERS) f.add("user", { ...user, passwordHash: `old-${user.id}` });
  const originalDate = globalThis.Date;
  const originalTimezone = process.env.TZ;
  const fixedInstant = new originalDate("2027-01-01T00:30:00.000Z");
  globalThis.Date = class extends originalDate {
    constructor(...args) { super(...(args.length ? args : [fixedInstant])); }
  };
  process.env.TZ = "America/Los_Angeles";
  try {
    assert.equal(new Date().getFullYear(), 2026);
    assert.equal(new Date().getUTCFullYear(), 2027);
    const baseline = JSON.parse(await captureAcceptanceBaseline(f.delegates));
    assert.equal(baseline.receiptSequence.year, 2026);
    assert.equal(baseline.receiptSequence.nextYear.year, 2027);
  } finally {
    globalThis.Date = originalDate;
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("acceptance baseline serializes private Golden hashes and the exact ReceiptSequence preimage", async () => {
  const f = createFixture();
  for (const user of GOLDEN_PASSWORD_USERS) f.add("user", { ...user, passwordHash: `old-${user.id}` });
  f.add("receiptSequence", { id: "seq-1", tenantId, year: 2026, lastNumber: 7, updatedAt: new Date("2026-01-01T00:00:00.000Z") });
  f.add("receiptSequence", { id: "seq-2027", tenantId, year: 2027, lastNumber: 2, updatedAt: new Date("2027-01-01T00:00:00.000Z") });
  const baseline = JSON.parse(await captureAcceptanceBaseline(f.delegates, 2026));
  assert.deepEqual(baseline.passwordHashes, GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })));
  assert.deepEqual(baseline.receiptSequence, {
    tenantId,
    year: 2026,
    row: { id: "seq-1", lastNumber: 7, updatedAt: "2026-01-01T00:00:00.000Z" },
    nextYear: { year: 2027, row: { id: "seq-2027", lastNumber: 2, updatedAt: "2027-01-01T00:00:00.000Z" } },
  });
});
test("failure after Expense cleans its exact registered row", async () => {
  const f = createFixture(); const row = { id: "expense-fail", tenantId, buildingId }; f.add("expense", row); f.cleanup.register("expense", row); await f.cleanup.cleanup(); assert.equal(f.delegates.expense.values.size, 0);
});
test("failure after Income cleans its exact registered row", async () => {
  const f = createFixture(); const row = { id: "income-fail", tenantId, buildingId }; f.add("income", row); f.cleanup.register("income", row); await f.cleanup.cleanup(); assert.equal(f.delegates.income.values.size, 0);
});
test("generic Document and payment-proof namespaces accept exact product keys", () => {
  const f = createFixture();
  for (const objectKey of [`tenant-${tenantId}/documents/doc.pdf`, `tenant-${tenantId}/payment-proofs/proof.pdf`]) {
    assert.doesNotThrow(() => f.cleanup.registerObject({ tenantId, bucket: "staging", objectKey, objectVersionId: versionId }));
  }
});
test("generic storage registration rejects slash namespaces, cross-tenant keys, and tenant-prefix collisions", () => {
  const f = createFixture();
  for (const objectKey of [
    `tenant/${tenantId}/payment-proofs/proof.pdf`,
    "tenant-stg-golden-tenant-auto-other/payment-proofs/proof.pdf",
    "tenant-other-tenant/payment-proofs/proof.pdf",
  ]) {
    assert.throws(() => f.cleanup.registerObject({ tenantId, bucket: "staging", objectKey, objectVersionId: versionId }), /fixed tenant/);
  }
  assert.throws(() => f.cleanup.registerObject({ tenantId: "other-tenant", bucket: "staging", objectKey: `tenant-${tenantId}/payment-proofs/proof.pdf`, objectVersionId: versionId }), /fixed tenant/);
});
test("failure after payment-proof upload cleans exact version before a File exists", async () => {
  const f = createFixture(); const key = `tenant-${tenantId}/payment-proofs/orphan.pdf`; f.storageRows.set(`staging\0${key}\0${versionId}`, true); f.cleanup.registerObject({ tenantId, bucket: "staging", objectKey: key, objectVersionId: versionId }); await f.cleanup.cleanup();
  assert.equal(f.fileLookups.includes(null), false);
  assert.deepEqual(f.storageRemovals, [{ bucket: "staging", key, versionId }]);
  assert.equal(f.storageRows.size, 0);
});
test("registered File-backed storage requires the exact File identity before deletion", async () => {
  const f = createFixture();
  const key = `tenant-${tenantId}/documents/file-backed.pdf`;
  f.add("file", { id: "proof-file-1", tenantId, bucket: "staging", objectKey: key, objectVersionId: "different-version" });
  f.cleanup.registerObject({ tenantId, bucket: "staging", objectKey: key, objectVersionId: versionId, fileId: "proof-file-1" });
  f.storageRows.set(`staging\0${key}\0${versionId}`, true);
  await assert.rejects(f.cleanup.cleanup(), /storage identity no longer matches its registered File/);
  assert.deepEqual(f.storageRemovals, []);
  assert.equal(f.storageRows.size, 1);
});
test("failure after Document/File creation cleans exact rows", async () => {
  const f = createFixture(); addBaseResources(f); await f.cleanup.cleanup(); assert.equal(f.delegates.document.values.size, 0); assert.equal(f.delegates.file.values.size, 0);
});
test("failure after Payment creation removes exact dependent rows", async () => {
  const f = createFixture(); addBaseResources(f); await f.cleanup.cleanup(); assert.equal(f.delegates.payment.values.size, 0); assert.equal(f.delegates.paymentAllocation.values.size, 0); assert.equal(f.delegates.paymentAuditLog.values.size, 0);
});
test("receipt-generated Document/File are discovered from the exact Payment", async () => {
  const f = createFixture(); addBaseResources(f, { withReceipt: true }); await f.cleanup.cleanup(); assert.equal(f.delegates.document.values.size, 0); assert.equal(f.delegates.file.values.size, 0); assert.equal(f.storageRows.size, 0);
  assert.deepEqual(f.storageRemovals, [{ bucket: "staging", key: `tenant-${tenantId}/payment-proofs/run-1.pdf`, versionId }, { bucket: "staging", key: `tenant/${tenantId}/payments/payment-1/receipts/R-GOLDEN-2026-000011.pdf`, versionId: "receipt-version" }]);
});
test("receipt cleanup rejects a key not derived from the exact Payment receipt identity", async () => {
  const f = createFixture(); addBaseResources(f, { withReceipt: true });
  const file = f.delegates.file.values.get("receipt-file-1");
  file.objectKey = `tenant/${tenantId}/payments/payment-1/receipts/other.pdf`;
  await assert.rejects(f.cleanup.cleanup(), /does not match the exact Payment receipt/);
  assert.equal(f.storageRemovals.some(({ key }) => key === file.objectKey), false);
  assert.equal(f.storageRows.has(`staging\0tenant/${tenantId}/payments/payment-1/receipts/R-GOLDEN-2026-000011.pdf\0receipt-version`), true);
});
test("receipt cleanup fails closed on Document building or File tenant mismatch", async () => {
  for (const mutate of [
    (f) => { f.delegates.document.values.get("receipt-doc-1").buildingId = "other-building"; },
    (f) => { f.delegates.document.values.get("receipt-doc-1").fileId = "proof-file-1"; },
    (f) => { f.delegates.file.values.get("receipt-file-1").tenantId = "other-tenant"; },
  ]) {
    const f = createFixture(); addBaseResources(f, { withReceipt: true }); mutate(f);
    await assert.rejects(f.cleanup.cleanup());
    assert.equal(f.storageRemovals.some(({ key }) => key.includes("/payments/payment-1/receipts/")), false);
  }
});
test("receipt issued in the next UTC year restores that year's exact sequence preimage", async () => {
  const f = createFixture();
  const nextYearSequence = { id: "seq-2027", tenantId, year: 2027, lastNumber: 4, updatedAt: new Date("2027-01-01T00:00:00.000Z") };
  f.add("receiptSequence", nextYearSequence);
  addBaseResources(f, { withReceipt: true });
  const payment = f.delegates.payment.values.get("payment-1");
  payment.receiptNumber = "R-GOLDEN-2027-000005";
  f.delegates.receiptSequence.values.get("seq-1").lastNumber = 10;
  f.delegates.receiptSequence.values.get("seq-1").updatedAt = new Date("2026-01-01T00:00:00.000Z");
  f.delegates.receiptSequence.values.get("seq-2027").lastNumber = 5;
  f.delegates.receiptSequence.values.get("seq-2027").updatedAt = new Date("2027-01-02T00:00:00.000Z");
  f.delegates.file.values.get("receipt-file-1").objectKey = `tenant/${tenantId}/payments/payment-1/receipts/R-GOLDEN-2027-000005.pdf`;
  const cleanup = createAcceptanceCleanup({ prisma: f.delegates, storage: f.storage, runId: "test-run", baseline: {
    passwordHashes: GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })),
    receiptSequence: { tenantId, year: 2026, row: { id: "seq-1", lastNumber: 10, updatedAt: "2026-01-01T00:00:00.000Z" }, nextYear: { year: 2027, row: { id: "seq-2027", lastNumber: 4, updatedAt: "2027-01-01T00:00:00.000Z" } } },
  }, qaUserId, onPass() {} });
  for (const kind of ["expense", "income", "charge", "payment"]) cleanup.register(kind, f.delegates[kind].values.get(`${kind}-1`));
  cleanup.register("document", f.delegates.document.values.get("proof-doc-1"));
  cleanup.register("file", f.delegates.file.values.get("proof-file-1"));
  cleanup.registerObject({ tenantId, bucket: "staging", objectKey: `tenant-${tenantId}/payment-proofs/run-1.pdf`, objectVersionId: versionId, fileId: "proof-file-1" });
  cleanup.setSessionId("session-run");
  await cleanup.cleanup();
  const restored = await f.delegates.receiptSequence.findUnique({ where: { tenantId_year: { tenantId, year: 2027 } } });
  assert.equal(restored.lastNumber, 4);
  assert.equal(restored.updatedAt.toISOString(), "2027-01-01T00:00:00.000Z");
  const currentYear = await f.delegates.receiptSequence.findUnique({ where: { tenantId_year: { tenantId, year: 2026 } } });
  assert.equal(currentYear.lastNumber, 10);
  assert.equal(currentYear.updatedAt.toISOString(), "2026-01-01T00:00:00.000Z");
});

test("next-year receipt fails closed when that year's preimage was not captured", async () => {
  const f = createFixture();
  addBaseResources(f, { withReceipt: true });
  const payment = f.delegates.payment.values.get("payment-1");
  payment.receiptNumber = "R-GOLDEN-2027-000005";
  f.delegates.receiptSequence.values.get("seq-1").lastNumber = 10;
  f.delegates.receiptSequence.values.get("seq-1").updatedAt = new Date("2026-01-01T00:00:00.000Z");
  f.add("receiptSequence", { id: "seq-2027", tenantId, year: 2027, lastNumber: 5, updatedAt: new Date("2027-01-02T00:00:00.000Z") });
  f.delegates.file.values.get("receipt-file-1").objectKey = `tenant/${tenantId}/payments/payment-1/receipts/R-GOLDEN-2027-000005.pdf`;
  const cleanup = createAcceptanceCleanup({ prisma: f.delegates, storage: f.storage, runId: "test-run", baseline: {
    passwordHashes: GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })),
    receiptSequence: { tenantId, year: 2026, row: { id: "seq-1", lastNumber: 10, updatedAt: "2026-01-01T00:00:00.000Z" } },
  }, qaUserId, onPass() {} });
  for (const kind of ["expense", "income", "charge", "payment"]) cleanup.register(kind, f.delegates[kind].values.get(`${kind}-1`));
  cleanup.register("document", f.delegates.document.values.get("proof-doc-1"));
  cleanup.register("file", f.delegates.file.values.get("proof-file-1"));
  cleanup.registerObject({ tenantId, bucket: "staging", objectKey: `tenant-${tenantId}/payment-proofs/run-1.pdf`, objectVersionId: versionId, fileId: "proof-file-1" });
  cleanup.setSessionId("session-run");
  await assert.rejects(cleanup.cleanup(), /next-year receipt sequence preimage is missing/);
  assert.equal(f.delegates.receiptSequence.values.get("seq-2027").lastNumber, 5);
  assert.equal(f.delegates.receiptSequence.values.get("seq-2027").updatedAt.toISOString(), "2027-01-02T00:00:00.000Z");
});

test("run-owned final receipt number restores its exact shared sequence preimage", async () => {
  const proof = [];
  const f = createFixture({ onPass: (marker) => proof.push(marker) });
  addBaseResources(f, { withReceipt: true });
  await f.cleanup.cleanup();
  const restored = await f.delegates.receiptSequence.findUnique({ where: { tenantId_year: { tenantId, year: 2026 } } });
  assert.equal(restored.lastNumber, 10);
  assert.equal(restored.updatedAt.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.ok(proof.includes("QA_RECEIPT_SEQUENCE_RESTORE_PASS"));
  assert.ok(proof.includes("QA_RECEIPT_SEQUENCE_BASELINE_PROOF_PASS"));
  assert.ok(!proof.includes("QA_RECEIPT_SEQUENCE_BASELINE_UNCHANGED_PASS"));
});
test("current-year receipt fails closed without both consecutive-year preimages", async () => {
  const proof = [];
  const f = createFixture();
  addBaseResources(f, { withReceipt: true });
  const currentSequence = f.delegates.receiptSequence.values.get("seq-1");
  currentSequence.lastNumber = 11;
  currentSequence.updatedAt = new Date("2026-01-02T00:00:00.000Z");
  const cleanup = createAcceptanceCleanup({ prisma: f.delegates, storage: f.storage, runId: "test-run", baseline: {
    passwordHashes: GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })),
    receiptSequence: { tenantId, year: 2026, row: { id: "seq-1", lastNumber: 10, updatedAt: "2026-01-01T00:00:00.000Z" } },
  }, qaUserId, onPass: (marker) => proof.push(marker) });
  for (const kind of ["expense", "income", "charge", "payment"]) cleanup.register(kind, f.delegates[kind].values.get(`${kind}-1`));
  cleanup.register("document", f.delegates.document.values.get("proof-doc-1"));
  cleanup.register("file", f.delegates.file.values.get("proof-file-1"));
  cleanup.registerObject({ tenantId, bucket: "staging", objectKey: `tenant-${tenantId}/payment-proofs/run-1.pdf`, objectVersionId: versionId, fileId: "proof-file-1" });
  cleanup.setSessionId("session-run");

  let cleanupError;
  try { await cleanup.cleanup(); } catch (error) { cleanupError = error; }
  assert.ok(cleanupError, `cleanup resolved with sequence ${f.delegates.receiptSequence.values.get("seq-1").lastNumber} and proof ${proof.join(",")}`);
  assert.match(cleanupError.message, /next-year receipt sequence preimage is missing/);
  assert.equal(f.delegates.receiptSequence.values.get("seq-1").lastNumber, 11, "incomplete baseline must not restore the sequence");
  assert.equal(f.delegates.receiptSequence.values.get("seq-1").updatedAt.toISOString(), "2026-01-02T00:00:00.000Z");
  assert.ok(!proof.includes("QA_RECEIPT_SEQUENCE_BASELINE_PROOF_PASS"), "incomplete baseline must not emit sequence proof");
  assert.ok(!proof.includes("RUN_SCOPED_MUTABLE_DB_RESIDUE=0"), "incomplete baseline must not emit zero-residue proof");
});

test("receipt restore fails closed when the untargeted captured year changed", async () => {
  const proof = [];
  const f = createFixture({ onPass: (marker) => proof.push(marker) });
  addBaseResources(f, { withReceipt: true });
  const otherYear = { id: "seq-2027", tenantId, year: 2027, lastNumber: 3, updatedAt: new Date("2027-01-01T00:00:00.000Z") };
  f.add("receiptSequence", otherYear);
  const cleanup = createAcceptanceCleanup({ prisma: f.delegates, storage: f.storage, runId: "test-run", baseline: {
    passwordHashes: GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })),
    receiptSequence: { tenantId, year: 2026, row: { id: "seq-1", lastNumber: 10, updatedAt: "2026-01-01T00:00:00.000Z" }, nextYear: { year: 2027, row: { id: otherYear.id, lastNumber: otherYear.lastNumber, updatedAt: otherYear.updatedAt.toISOString() } } },
  }, qaUserId, onPass: (marker) => proof.push(marker) });
  for (const kind of ["expense", "income", "charge", "payment"]) cleanup.register(kind, f.delegates[kind].values.get(`${kind}-1`));
  cleanup.register("document", f.delegates.document.values.get("proof-doc-1"));
  cleanup.register("file", f.delegates.file.values.get("proof-file-1"));
  cleanup.registerObject({ tenantId, bucket: "staging", objectKey: `tenant-${tenantId}/payment-proofs/run-1.pdf`, objectVersionId: versionId, fileId: "proof-file-1" });
  cleanup.setSessionId("session-run");
  const changed = f.delegates.receiptSequence.values.get(otherYear.id);
  changed.lastNumber = 4;
  changed.updatedAt = new Date("2027-01-02T00:00:00.000Z");
  const expectedOtherYear = structuredClone(changed);
  await assert.rejects(cleanup.cleanup(), /captured baseline/);
  const restoredReceiptYear = await f.delegates.receiptSequence.findUnique({ where: { tenantId_year: { tenantId, year: 2026 } } });
  assert.equal(restoredReceiptYear.lastNumber, 10);
  assert.equal(restoredReceiptYear.updatedAt.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.deepEqual(f.delegates.receiptSequence.values.get(otherYear.id), expectedOtherYear, "cleanup must preserve the concurrent mutation in the other year");
  assert.ok(!proof.includes("QA_RECEIPT_SEQUENCE_BASELINE_PROOF_PASS"));
  assert.ok(!proof.includes("RUN_SCOPED_MUTABLE_DB_RESIDUE=0"));
});

test("receipt sequence is not rewound when a later concurrent receipt exists", async () => {
  const f = createFixture(); addBaseResources(f, { withReceipt: true });
  const row = f.delegates.receiptSequence.values.get("seq-1"); row.lastNumber = 12;
  await assert.rejects(f.cleanup.cleanup(), /receipt sequence advanced concurrently/);
  assert.equal(f.delegates.receiptSequence.values.get("seq-1").lastNumber, 12);
});

test("no-receipt cleanup proves both captured sequence years unchanged without claiming restoration", async () => {
  const f = createFixture(); addBaseResources(f);
  const nextYearRow = { id: "seq-2027", tenantId, year: 2027, lastNumber: 3, updatedAt: new Date("2027-01-01T00:00:00.000Z") };
  f.add("receiptSequence", nextYearRow);
  const proof = [];
  const cleanup = createAcceptanceCleanup({ prisma: f.delegates, storage: f.storage, runId: "test-run", baseline: {
    passwordHashes: GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })),
    receiptSequence: { tenantId, year: 2026, row: { id: "seq-1", lastNumber: 10, updatedAt: "2026-01-01T00:00:00.000Z" }, nextYear: { year: 2027, row: { id: "seq-2027", lastNumber: 3, updatedAt: "2027-01-01T00:00:00.000Z" } } },
  }, qaUserId, onPass: (marker) => proof.push(marker) });
  cleanup.register("expense", { id: "expense-1", tenantId, buildingId });
  cleanup.register("income", { id: "income-1", tenantId, buildingId });
  cleanup.register("charge", { id: "charge-1", tenantId, buildingId });
  cleanup.register("payment", { id: "payment-1", tenantId, buildingId });
  cleanup.setSessionId("session-run");
  await cleanup.cleanup();
  assert.ok(proof.includes("QA_RECEIPT_SEQUENCE_BASELINE_UNCHANGED_PASS"));
  assert.ok(proof.includes("QA_RECEIPT_SEQUENCE_BASELINE_PROOF_PASS"));
  assert.ok(!proof.includes("QA_RECEIPT_SEQUENCE_RESTORE_PASS"));
  assert.deepEqual(await f.delegates.receiptSequence.findUnique({ where: { tenantId_year: { tenantId, year: 2027 } } }), nextYearRow);
});

test("no-receipt cleanup fails closed without mutating an altered sequence baseline", async () => {
  const f = createFixture(); addBaseResources(f);
  f.delegates.receiptSequence.values.get("seq-1").lastNumber = 11;
  await assert.rejects(f.cleanup.cleanup(), /without a receipt number/);
  assert.equal(f.delegates.receiptSequence.values.get("seq-1").lastNumber, 11);
});

test("no-receipt cleanup fails closed when a captured existing sequence row disappears", async () => {
  const f = createFixture(); addBaseResources(f);
  f.delegates.receiptSequence.values.delete("seq-1");
  await assert.rejects(f.cleanup.cleanup(), /without a receipt number/);
  assert.equal(f.delegates.receiptSequence.values.has("seq-1"), false);
});

test("no-receipt cleanup proves baseline-null sequence row remains absent", async () => {
  const proof = [];
  const f = createFixture(); addBaseResources(f);
  f.delegates.receiptSequence.values.clear();
  const cleanup = createAcceptanceCleanup({ prisma: f.delegates, storage: f.storage, runId: "test-run", baseline: {
    passwordHashes: GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })),
    receiptSequence: { tenantId, year: 2026, row: null, nextYear: { year: 2027, row: null } },
  }, qaUserId, onPass: (marker) => proof.push(marker) });
  for (const kind of ["expense", "income", "charge", "payment"]) cleanup.register(kind, { id: `${kind}-1`, tenantId, buildingId });
  cleanup.setSessionId("session-run");
  await cleanup.cleanup();
  assert.deepEqual([...f.delegates.receiptSequence.values], []);
  assert.ok(proof.includes("QA_RECEIPT_SEQUENCE_BASELINE_UNCHANGED_PASS"));
  assert.ok(proof.includes("QA_RECEIPT_SEQUENCE_BASELINE_PROOF_PASS"));
});

test("no-receipt cleanup fails closed when baseline-null sequence row appeared", async () => {
  const f = createFixture(); addBaseResources(f);
  f.delegates.receiptSequence.values.clear();
  const cleanup = createAcceptanceCleanup({ prisma: f.delegates, storage: f.storage, runId: "test-run", baseline: {
    passwordHashes: GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })),
    receiptSequence: { tenantId, year: 2026, row: null, nextYear: { year: 2027, row: null } },
  }, qaUserId, onPass() {} });
  cleanup.register("expense", { id: "expense-1", tenantId, buildingId });
  cleanup.register("income", { id: "income-1", tenantId, buildingId });
  cleanup.register("charge", { id: "charge-1", tenantId, buildingId });
  cleanup.register("payment", { id: "payment-1", tenantId, buildingId });
  cleanup.setSessionId("session-run");
  f.add("receiptSequence", { id: "appeared", tenantId, year: 2026, lastNumber: 1, updatedAt: new Date("2026-01-02T00:00:00.000Z") });
  await assert.rejects(cleanup.cleanup(), /without a receipt number/);
  assert.equal(f.delegates.receiptSequence.values.has("appeared"), true);
});
test("cross-tenant registration is rejected before mutation", async () => {
  const f = createFixture(); const row = { id: "foreign", tenantId: "other-tenant", buildingId }; assert.throws(() => f.cleanup.register("expense", row), /fixed tenant/); assert.equal(f.delegates.expense.values.size, 0);
});
test("registered row moved to another building is preserved", async () => {
  const f = createFixture();
  const row = { id: "moved-expense", tenantId, buildingId, description: "run expense" };
  f.add("expense", row); f.cleanup.register("expense", row);
  f.delegates.expense.values.get(row.id).buildingId = "other-building";
  await assert.rejects(f.cleanup.cleanup(), /building ownership changed before cleanup/);
  assert.equal(f.delegates.expense.values.has(row.id), true);
});
test("unregistered resources are not deleted", async () => {
  const f = createFixture(); f.add("expense", { id: "unregistered", tenantId, buildingId }); await f.cleanup.cleanup(); assert.equal(f.delegates.expense.values.has("unregistered"), true);
});
test("unregistered run-marker residue fails closed without deleting the unknown row", async () => {
  const f = createFixture();
  const row = { id: "unregistered-run-expense", tenantId, buildingId, description: "FIN-02C-STAGING:test-run:expense" };
  f.add("expense", row);
  await assert.rejects(f.cleanup.cleanup(), /unregistered Expense residue remains/);
  assert.equal(f.delegates.expense.values.has(row.id), true);
});
test("cleanup failures propagate as acceptance failures", async () => {
  const f = createFixture(); addBaseResources(f); f.storageRows.clear(); f.storage.removeObject = async () => { throw new Error("storage denied"); }; await assert.rejects(f.cleanup.cleanup(), AggregateError);
});
test("repeated cleanup is idempotent", async () => {
  const f = createFixture(); addBaseResources(f); await f.cleanup.cleanup(); await f.cleanup.cleanup(); assert.equal(f.storageRows.size, 0);
});
test("session identity is extracted only from the signed access-token claims", () => {
  const payload = Buffer.from(JSON.stringify({ sub: qaUserId, sid: "session-exact" })).toString("base64url");
  assert.equal(decodeRunSessionId([`bo_access_token=x.${payload}.sig`], qaUserId), "session-exact");
  assert.throws(() => decodeRunSessionId([`bo_access_token=x.${payload}.sig`], "other-user"), /not bound/);
});
test("missing run session identity fails closed after a login attempt", async () => {
  const f = createFixture(); f.cleanup.markSessionAttempted(); await assert.rejects(f.cleanup.cleanup(), /exact AuthSession identity was not captured/);
});
