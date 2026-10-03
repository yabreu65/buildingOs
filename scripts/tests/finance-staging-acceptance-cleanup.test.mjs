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

function createFixture() {
  const delegates = {
    expense: makeDelegate(), income: makeDelegate(), charge: makeDelegate(), payment: makeDelegate(),
    document: makeDelegate(), file: makeDelegate(), paymentAllocation: makeDelegate(), paymentAuditLog: makeDelegate(),
    authSession: makeDelegate(), membership: makeDelegate(), user: makeDelegate(), auditLog: makeDelegate(), receiptSequence: makeDelegate(),
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
    cleanup: createAcceptanceCleanup({ prisma: delegates, storage, runId: "test-run", baseline: { passwordHashes: GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })), receiptSequence: { tenantId, year: 2026, row: { id: "seq-1", lastNumber: 10, updatedAt: "2026-01-01T00:00:00.000Z" } } }, qaUserId, onPass() {} }),
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
test("AUTH_LOGIN AuditLog is durable and preserved", async () => {
  const f = createFixture(); addBaseResources(f); await f.cleanup.cleanup(); assert.equal(f.delegates.auditLog.values.has("auth-audit-1"), true);
  assert.deepEqual(ACCEPTANCE_MUTATION_INVENTORY[0], { resource: "AUTH_LOGIN AuditLog", classification: "DURABLE_AUDIT_EVIDENCE", cleanup: "NONE" });
});
test("AuditLog growth is excluded from mutable residue checks", async () => {
  const f = createFixture(); addBaseResources(f); f.add("auditLog", { id: "auth-audit-2", action: "AUTH_LOGIN", actorUserId: qaUserId }); await f.cleanup.cleanup(); assert.equal(f.delegates.auditLog.values.size, 2);
});
test("Golden password hashes are captured privately and restored exactly", async () => {
  const users = makeDelegate(GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })));
  const snapshot = await captureGoldenPasswordHashes(users);
  for (const user of GOLDEN_PASSWORD_USERS) await users.updateMany({ where: user, data: { passwordHash: "ephemeral" } });
  await restoreGoldenPasswordHashes(users, snapshot);
  for (const user of GOLDEN_PASSWORD_USERS) assert.equal((await users.findFirst({ where: { id: user.id } })).passwordHash, `old-${user.id}`);
});
test("Golden password restoration attempts every exact user and fails if one update fails", async () => {
  const users = makeDelegate(GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })));
  const snapshot = await captureGoldenPasswordHashes(users);
  const attempted = [];
  const updateMany = users.updateMany;
  users.updateMany = async (args) => {
    attempted.push(args.where.id);
    if (args.where.id === GOLDEN_PASSWORD_USERS[0].id) throw new Error("injected restore failure");
    return updateMany(args);
  };
  await assert.rejects(restoreGoldenPasswordHashes(users, snapshot), AggregateError);
  assert.deepEqual(attempted, GOLDEN_PASSWORD_USERS.map(({ id }) => id));
  assert.equal((await users.findFirst({ where: { id: GOLDEN_PASSWORD_USERS[1].id } })).passwordHash, `old-${GOLDEN_PASSWORD_USERS[1].id}`);
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
      receiptSequence: { tenantId, year: 2026, row: { id: "seq-1", lastNumber: 7, updatedAt: "2026-01-01T00:00:00.000Z" } },
    },
    qaUserId,
    onPass() {},
  }));
});
test("acceptance baseline serializes private Golden hashes and the exact ReceiptSequence preimage", async () => {
  const f = createFixture();
  for (const user of GOLDEN_PASSWORD_USERS) f.add("user", { ...user, passwordHash: `old-${user.id}` });
  f.add("receiptSequence", { id: "seq-1", tenantId, year: 2026, lastNumber: 7, updatedAt: new Date("2026-01-01T00:00:00.000Z") });
  const baseline = JSON.parse(await captureAcceptanceBaseline(f.delegates, 2026));
  assert.deepEqual(baseline.passwordHashes, GOLDEN_PASSWORD_USERS.map((user) => ({ ...user, passwordHash: `old-${user.id}` })));
  assert.deepEqual(baseline.receiptSequence, {
    tenantId,
    year: 2026,
    row: { id: "seq-1", lastNumber: 7, updatedAt: "2026-01-01T00:00:00.000Z" },
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
test("run-owned final receipt number restores its exact shared sequence preimage", async () => {
  const f = createFixture(); addBaseResources(f, { withReceipt: true }); await f.cleanup.cleanup();
  const restored = await f.delegates.receiptSequence.findUnique({ where: { tenantId_year: { tenantId, year: 2026 } } });
  assert.equal(restored.lastNumber, 10);
  assert.equal(restored.updatedAt.toISOString(), "2026-01-01T00:00:00.000Z");
});
test("receipt sequence is not rewound when a later concurrent receipt exists", async () => {
  const f = createFixture(); addBaseResources(f, { withReceipt: true });
  const row = f.delegates.receiptSequence.values.get("seq-1"); row.lastNumber = 12;
  await assert.rejects(f.cleanup.cleanup(), /receipt sequence advanced concurrently/);
  assert.equal(f.delegates.receiptSequence.values.get("seq-1").lastNumber, 12);
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
