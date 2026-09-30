export const ALLOWED_TENANT_ID = "stg-golden-tenant-auto";
export const ALLOWED_BUILDING_ID = "stg-golden-building-auto";
export const ALLOWED_QA_USER_ID = "stg-golden-user-auto-admin";
export const GOLDEN_PASSWORD_USERS = Object.freeze([
  { id: "stg-golden-user-auto-owner", email: "owner.autogestionada@staging.buildingos.local" },
  { id: "stg-golden-user-auto-admin", email: "admin.autogestionada@staging.buildingos.local" },
  { id: "stg-golden-user-auto-resident-1", email: "resident.auto.1@staging.buildingos.local" },
  { id: "stg-golden-user-auto-resident-2", email: "resident.auto.2@staging.buildingos.local" },
]);
export const ACCEPTANCE_MUTATION_INVENTORY = Object.freeze([
  { resource: "AUTH_LOGIN AuditLog", classification: "DURABLE_AUDIT_EVIDENCE", cleanup: "NONE" },
  { resource: "AuthSession", classification: "RUN_SCOPED_DB", cleanup: "exact session id and Golden QA user" },
  { resource: "Finance rows and Documents/Files", classification: "RUN_SCOPED_MUTABLE_DB", cleanup: "registered exact IDs with tenant/building ownership" },
  { resource: "S3 objects", classification: "RUN_SCOPED_STORAGE", cleanup: "exact bucket/key/version with File binding" },
  { resource: "ReceiptSequence", classification: "SHARED_MONOTONIC_FINANCE_STATE", cleanup: "restore only on exact compare-and-set; otherwise fail closed" },
  { resource: "Golden user passwordHash", classification: "GOLDEN_BASELINE_MUTATION", cleanup: "exact pre-seed value restored and verified" },
]);

const resourceKinds = ["expense", "income", "charge", "payment", "document", "file"];

function requireIdentity(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

export function decodeRunSessionId(cookieValues, expectedUserId) {
  const access = cookieValues.find((value) => value.startsWith("bo_access_token="));
  if (!access) throw new Error("login did not issue an access token");
  const token = access.slice("bo_access_token=".length);
  const segments = token.split(".");
  if (segments.length !== 3) throw new Error("access token is malformed");
  let payload;
  try {
    payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("access token payload is malformed");
  }
  if (payload.sub !== expectedUserId || typeof payload.sid !== "string" || !payload.sid) {
    throw new Error("access token is not bound to the Golden QA user and session");
  }
  return payload.sid;
}

export async function captureGoldenPasswordHashes(userDelegate) {
  const snapshot = [];
  for (const expected of GOLDEN_PASSWORD_USERS) {
    const user = await userDelegate.findFirst({ where: { id: expected.id } });
    if (!user || user.email !== expected.email || typeof user.passwordHash !== "string" || !user.passwordHash) {
      throw new Error("Golden password baseline is incomplete or mismatched");
    }
    snapshot.push({ ...expected, passwordHash: user.passwordHash });
  }
  return JSON.stringify(snapshot);
}

export async function captureAcceptanceBaseline(prisma, year = new Date().getFullYear()) {
  const passwordHashes = JSON.parse(await captureGoldenPasswordHashes(prisma.user));
  const receiptSequence = await prisma.receiptSequence.findUnique({
    where: { tenantId_year: { tenantId: ALLOWED_TENANT_ID, year } },
  });
  return JSON.stringify({
    passwordHashes,
    receiptSequence: {
      tenantId: ALLOWED_TENANT_ID,
      year,
      row: receiptSequence ? {
        id: receiptSequence.id,
        lastNumber: receiptSequence.lastNumber,
        updatedAt: receiptSequence.updatedAt.toISOString(),
      } : null,
    },
  });
}

export async function restoreGoldenPasswordHashes(userDelegate, serializedSnapshot) {
  let snapshot;
  try { snapshot = JSON.parse(serializedSnapshot); } catch { throw new Error("Golden password snapshot is invalid"); }
  if (!Array.isArray(snapshot)) snapshot = snapshot?.passwordHashes;
  if (!Array.isArray(snapshot) || snapshot.length !== GOLDEN_PASSWORD_USERS.length) {
    throw new Error("Golden password snapshot is incomplete");
  }
  for (const [index, expected] of GOLDEN_PASSWORD_USERS.entries()) {
    const entry = snapshot[index];
    if (entry?.id !== expected.id || entry?.email !== expected.email || typeof entry.passwordHash !== "string" || !entry.passwordHash) {
      throw new Error("Golden password snapshot identity is invalid");
    }
  }
  const errors = [];
  for (const entry of snapshot) {
    try {
      const result = await userDelegate.updateMany({
        where: { id: entry.id, email: entry.email },
        data: { passwordHash: entry.passwordHash },
      });
      if (result.count !== 1) throw new Error("Golden password baseline restore was not exact");
      const restored = await userDelegate.findFirst({ where: { id: entry.id } });
      if (restored?.email !== entry.email || restored.passwordHash !== entry.passwordHash) {
        throw new Error("Golden password baseline restore verification failed");
      }
    } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Golden password baseline restore failed");
}

export function createAcceptanceCleanup({ prisma, storage, runId, baseline, tenantId = ALLOWED_TENANT_ID, buildingId = ALLOWED_BUILDING_ID, qaUserId, onPass = console.log }) {
  if (tenantId !== ALLOWED_TENANT_ID || buildingId !== ALLOWED_BUILDING_ID || qaUserId !== ALLOWED_QA_USER_ID) {
    throw new Error("cleanup scope is not the fixed Golden tenant/building");
  }
  if (baseline?.receiptSequence?.tenantId !== tenantId || !Number.isInteger(baseline.receiptSequence.year)) {
    throw new Error("acceptance receipt-sequence baseline is missing or invalid");
  }
  const resources = Object.fromEntries(resourceKinds.map((kind) => [kind, new Map()]));
  const objects = new Map();
  const paymentRowsById = new Map();
  let sessionId;
  let sessionAttempted = false;

  const register = (kind, row) => {
    if (!resources[kind]) throw new Error("unrecognized run resource kind");
    const id = requireIdentity(row?.id, `${kind} id`);
    if (row.tenantId !== tenantId) throw new Error(`${kind} is outside the fixed tenant`);
    if (["expense", "income", "charge", "payment", "document"].includes(kind) && row.buildingId !== buildingId) {
      throw new Error(`${kind} is outside the fixed building`);
    }
    if (row.buildingId !== undefined && row.buildingId !== null && row.buildingId !== buildingId) {
      throw new Error(`${kind} is outside the fixed building`);
    }
    if (resources[kind].has(id)) throw new Error(`${kind} id was registered twice`);
    resources[kind].set(id, { id, tenantId, buildingId: row.buildingId ?? undefined });
  };

  const registerObject = (object) => {
    const bucket = requireIdentity(object?.bucket, "storage bucket");
    const objectKey = requireIdentity(object?.objectKey, "storage object key");
    const objectVersionId = requireIdentity(object?.objectVersionId, "storage object version");
    const fileId = object?.fileId ?? null;
    if (fileId !== null) requireIdentity(fileId, "storage File id");
    if (object.tenantId !== tenantId || !objectKey.startsWith(`tenant/${tenantId}/`)) {
      throw new Error("storage object is outside the fixed tenant");
    }
    const identity = `${bucket}\0${objectKey}\0${objectVersionId}`;
    const previous = objects.get(identity);
    if (previous && previous.fileId && fileId && previous.fileId !== fileId) throw new Error("storage object identity has conflicting File owners");
    objects.set(identity, { bucket, objectKey, objectVersionId, fileId: fileId ?? previous?.fileId ?? null });
  };

  const deleteExact = async (kind, delegate, row, extraWhere = {}) => {
    if (!row) return;
    if (row.tenantId !== tenantId || (row.buildingId && row.buildingId !== buildingId)) {
      throw new Error(`${kind} ownership changed before cleanup`);
    }
    const where = { id: row.id, tenantId, ...(row.buildingId ? { buildingId: row.buildingId } : {}), ...extraWhere };
    const result = await delegate.deleteMany({ where });
    if (result.count !== 1) throw new Error(`${kind} exact deletion was not proven`);
    const remaining = await delegate.findFirst({ where: { id: row.id, tenantId } });
    if (remaining) throw new Error(`${kind} residue remains after exact deletion`);
  };

  const exactRegisteredRows = async (kind, delegate, extraSelect = {}) => {
    const rows = [];
    for (const expected of resources[kind].values()) {
      const row = await delegate.findFirst({ where: { id: expected.id } });
      if (!row) continue;
      if (row.tenantId !== tenantId) {
        throw new Error(`${kind} registered ID is not owned by the acceptance run`);
      }
      if (row.buildingId && row.buildingId !== buildingId) {
        throw new Error(`${kind} building ownership changed before cleanup`);
      }
      if (expected.buildingId && row.buildingId !== expected.buildingId) {
        throw new Error(`${kind} building ownership changed before cleanup`);
      }
      rows.push({ ...row, ...extraSelect });
    }
    return rows;
  };

  async function restoreReceiptSequence() {
    const snapshot = baseline.receiptSequence;
    const receiptNumbers = [...new Set([...resources.payment.keys()].flatMap((id) => {
      const payment = paymentRowsById.get(id);
      return typeof payment?.receiptNumber === "string" ? [payment.receiptNumber] : [];
    }))];
    if (receiptNumbers.length > 1) throw new Error("acceptance run reserved more than one receipt number");
    const [receiptNumber] = receiptNumbers;
    const match = receiptNumber?.match(/^R-[A-Z0-9]+-(\d{4})-(\d{6})$/);
    if (receiptNumber && (!match || Number(match[1]) !== snapshot.year)) {
      throw new Error("acceptance receipt number does not match its private sequence baseline");
    }
    const original = snapshot.row;
    if (!receiptNumber) return;
    const current = await prisma.receiptSequence.findUnique({
      where: { tenantId_year: { tenantId, year: snapshot.year } },
    });
    const reservedNumber = Number(match[2]);
    if (original === null) {
      if (!current || reservedNumber !== 1 || current.lastNumber !== reservedNumber) {
        throw new Error("receipt sequence is no longer at the exact run-owned first number");
      }
      const result = await prisma.receiptSequence.deleteMany({ where: { id: current.id, tenantId, year: snapshot.year, lastNumber: reservedNumber } });
      if (result.count !== 1) throw new Error("run-created receipt sequence could not be removed exactly");
      const remaining = await prisma.receiptSequence.findUnique({ where: { tenantId_year: { tenantId, year: snapshot.year } } });
      if (remaining) throw new Error("run-created receipt sequence remains after cleanup");
      return;
    }
    if (!current || current.id !== original.id || reservedNumber !== original.lastNumber + 1 || current.lastNumber !== reservedNumber) {
      throw new Error("receipt sequence advanced concurrently; refusing to rewind shared numbering");
    }
    const result = await prisma.receiptSequence.updateMany({
      where: { id: current.id, tenantId, year: snapshot.year, lastNumber: reservedNumber, updatedAt: current.updatedAt },
      data: { lastNumber: original.lastNumber, updatedAt: new Date(original.updatedAt) },
    });
    if (result.count !== 1) throw new Error("receipt sequence compare-and-set restoration failed");
    const restored = await prisma.receiptSequence.findUnique({ where: { tenantId_year: { tenantId, year: snapshot.year } } });
    if (!restored || restored.id !== original.id || restored.lastNumber !== original.lastNumber || restored.updatedAt.toISOString() !== original.updatedAt) {
      throw new Error("receipt sequence baseline restoration could not be verified");
    }
  }

  async function cleanup() {
    const errors = [];
    const attempt = async (operation) => {
      try { await operation(); } catch (error) { errors.push(error); }
    };

    if (sessionId) await attempt(async () => {
      const membership = await prisma.membership.findFirst({ where: { userId: qaUserId, tenantId } });
      if (!membership) throw new Error("run AuthSession tenant binding cannot be verified");
      const session = await prisma.authSession.findFirst({ where: { id: sessionId } });
      if (session && session.userId !== qaUserId) throw new Error("run session belongs to another user");
      if (session) {
        const result = await prisma.authSession.deleteMany({ where: { id: sessionId, userId: qaUserId } });
        if (result.count !== 1) throw new Error("exact AuthSession deletion was not proven");
      }
      const remaining = await prisma.authSession.findFirst({ where: { id: sessionId, userId: qaUserId, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (remaining) throw new Error("active run AuthSession remains after exact cleanup");
    });
    else if (sessionAttempted) errors.push(new Error("login was attempted but exact AuthSession identity was not captured"));

    const paymentIds = [...resources.payment.keys()];
    const paymentRows = await exactRegisteredRows("payment", prisma.payment);
    paymentRowsById.clear();
    for (const row of paymentRows) paymentRowsById.set(row.id, row);
    for (const payment of paymentRows) {
      let currentPayment = payment;
      for (let attemptNumber = 0; attemptNumber < 30 && (currentPayment.receiptGenerationToken || currentPayment.receiptGenerationLeaseUntil); attemptNumber += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        currentPayment = await prisma.payment.findFirst({ where: { id: payment.id } });
      if (!currentPayment || currentPayment.tenantId !== tenantId || currentPayment.buildingId !== buildingId) {
          throw new Error("Payment ownership changed while waiting for receipt generation");
        }
      }
      Object.assign(payment, currentPayment);
      if (currentPayment?.receiptGenerationToken || currentPayment?.receiptGenerationLeaseUntil) {
        errors.push(new Error("receipt generation did not settle before exact cleanup"));
        continue;
      }
      const allocations = await prisma.paymentAllocation.findMany({ where: { tenantId, paymentId: payment.id } });
      for (const row of allocations) {
        if (row.paymentId !== payment.id || row.tenantId !== tenantId) throw new Error("PaymentAllocation ownership mismatch");
        await attempt(() => deleteExact("PaymentAllocation", prisma.paymentAllocation, row, { paymentId: payment.id }));
      }
      const audits = await prisma.paymentAuditLog.findMany({ where: { tenantId, paymentId: payment.id } });
      for (const row of audits) {
        if (row.paymentId !== payment.id || row.tenantId !== tenantId) throw new Error("PaymentAuditLog ownership mismatch");
        await attempt(() => deleteExact("PaymentAuditLog", prisma.paymentAuditLog, row, { paymentId: payment.id }));
      }
      const receiptId = currentPayment?.receiptDocumentId;
      if (receiptId && !resources.document.has(receiptId)) {
        const document = await prisma.document.findFirst({ where: { id: receiptId } });
        if (document) {
          if (document.tenantId !== tenantId || document.buildingId !== buildingId) throw new Error("receipt Document ownership mismatch");
          register("document", document);
          const file = await prisma.file.findFirst({ where: { id: document.fileId } });
          if (file) {
            if (file.tenantId !== tenantId) throw new Error("receipt File ownership mismatch");
            register("file", file);
            registerObject({ ...file, fileId: file.id, objectVersionId: file.objectVersionId });
          }
        }
      }
    }

    for (const row of await exactRegisteredRows("document", prisma.document)) {
      const file = await prisma.file.findFirst({ where: { id: row.fileId } });
      if (file && file.tenantId !== tenantId) throw new Error("Document File ownership mismatch");
      if (file && !resources.file.has(file.id)) register("file", file);
      if (file && typeof file.objectVersionId === "string" && file.objectVersionId.length) {
        registerObject({ ...file, fileId: file.id, objectVersionId: file.objectVersionId });
      }
    }

    for (const object of objects.values()) await attempt(async () => {
      const file = await prisma.file.findFirst({ where: { id: object.fileId } });
      if (file && (file.tenantId !== tenantId || file.bucket !== object.bucket || file.objectKey !== object.objectKey || file.objectVersionId !== object.objectVersionId || (object.fileId && file.id !== object.fileId))) {
        throw new Error("storage identity no longer matches its registered File");
      }
      await storage.removeObject(object.bucket, object.objectKey, { versionId: object.objectVersionId });
      try {
        const stream = await storage.getObject(object.bucket, object.objectKey, { versionId: object.objectVersionId });
        stream.destroy();
        throw new Error("exact storage version is still retrievable after deletion");
      } catch (error) {
        if (error?.code !== "NoSuchVersion" && error?.code !== "NoSuchKey" && error?.code !== "NotFound" && error?.statusCode !== 404) throw error;
      }
    });

    for (const row of await exactRegisteredRows("document", prisma.document)) {
      await attempt(() => deleteExact("Document", prisma.document, row));
    }
    for (const row of await exactRegisteredRows("file", prisma.file)) {
      await attempt(() => deleteExact("File", prisma.file, row));
    }
    for (const payment of paymentRows) await attempt(() => deleteExact("Payment", prisma.payment, payment));
    for (const kind of ["charge", "income", "expense"]) {
      const delegate = prisma[kind];
      for (const row of await exactRegisteredRows(kind, delegate)) await attempt(() => deleteExact(kind, delegate, row));
    }

    for (const kind of resourceKinds) {
      for (const expected of resources[kind].values()) {
        const row = await prisma[kind].findFirst({ where: { id: expected.id } });
        if (row) errors.push(new Error(`${kind} ${expected.id} remains after cleanup`));
      }
    }
    for (const paymentId of paymentIds) {
      for (const [kind, delegate] of [["PaymentAllocation", prisma.paymentAllocation], ["PaymentAuditLog", prisma.paymentAuditLog]]) {
        const remaining = await delegate.findMany({ where: { tenantId, paymentId } });
        if (remaining.length) errors.push(new Error(`${kind} residue remains for registered payment`));
      }
    }
    const runMarker = `FIN-02C-STAGING:${runId}`;
    const unregisteredRunRows = [
      ["Expense", prisma.expense, { tenantId, buildingId, description: { startsWith: `${runMarker}:expense` } }],
      ["Income", prisma.income, { tenantId, buildingId, description: `${runMarker}:income` }],
      ["Charge", prisma.charge, { tenantId, buildingId, concept: `${runMarker}:charge` }],
      ["Payment", prisma.payment, { tenantId, buildingId, reference: `${runMarker}:payment` }],
      ["Document", prisma.document, { tenantId, buildingId, title: `${runMarker}:payment-proof` }],
    ];
    for (const [kind, delegate, where] of unregisteredRunRows) {
      const rows = await delegate.findMany({ where });
      if (rows.length) errors.push(new Error(`unregistered ${kind} residue remains for the acceptance run`));
    }
    if (errors.length === 0) {
      try { await restoreReceiptSequence(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, `acceptance cleanup failed for run ${runId}: ${errors.map((error) => error instanceof Error ? error.message : "unknown cleanup error").join("; ")}`);
    onPass("QA_RUN_MUTABLE_DB_CLEANUP_PASS");
    onPass("QA_RUN_STORAGE_CLEANUP_PASS");
    onPass("QA_AUTH_SESSION_CLEANUP_PASS");
    onPass("QA_AUDIT_HISTORY_PRESERVED_PASS");
    onPass("RUN_SCOPED_MUTABLE_DB_RESIDUE=0");
    onPass("RUN_SCOPED_STORAGE_RESIDUE=0");
    onPass("RUN_SCOPED_ACTIVE_SESSION_RESIDUE=0");
  }

  return {
    register,
    registerObject,
    markSessionAttempted() { sessionAttempted = true; },
    setSessionId(value) { sessionId = requireIdentity(value, "run AuthSession id"); },
    cleanup,
    snapshot() { return Object.fromEntries(resourceKinds.map((kind) => [kind, [...resources[kind].keys()]])); },
  };
}
