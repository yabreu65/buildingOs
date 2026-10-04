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
  // Seed convergence establishes durable QA fixtures; they are not run-scoped residue.
  { resource: "Golden staging seed fixtures", classification: "DURABLE_QA_BASELINE", scope: "stg-golden-tenant-auto", cleanup: "NONE" },
  { resource: "AuthSession", classification: "RUN_SCOPED_DB", cleanup: "exact session id and Golden QA user" },
  { resource: "Finance rows and Documents/Files", classification: "RUN_SCOPED_MUTABLE_DB", cleanup: "registered exact IDs with tenant/building ownership" },
  { resource: "S3 objects", classification: "RUN_SCOPED_STORAGE", cleanup: "exact bucket/key/version with File binding" },
  { resource: "ReceiptSequence", classification: "SHARED_MONOTONIC_FINANCE_STATE", cleanup: "restore only on exact compare-and-set; otherwise fail closed" },
  { resource: "Golden user passwordHash", classification: "EPHEMERAL_GOLDEN_AUTH_MUTATION", cleanup: "exact pre-seed hash restored and verified" },
]);

const resourceKinds = ["expense", "income", "charge", "payment", "document", "file"];

function requireIdentity(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

function isGenericDocumentObjectKey(objectKey, tenantId) {
  const prefixes = [
    `tenant-${tenantId}/documents/`,
    `tenant-${tenantId}/payment-proofs/`,
  ];
  const prefix = prefixes.find((candidate) => objectKey.startsWith(candidate));
  if (!prefix) return false;
  const relativePath = objectKey.slice(prefix.length);
  return relativePath.length > 0 && !relativePath.includes("\\") && !relativePath.includes("\0") &&
    relativePath.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
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
  const captureSequence = async (sequenceYear) => {
    const row = await prisma.receiptSequence.findUnique({
      where: { tenantId_year: { tenantId: ALLOWED_TENANT_ID, year: sequenceYear } },
    });
    return { year: sequenceYear, row: row ? {
      id: row.id,
      lastNumber: row.lastNumber,
      updatedAt: row.updatedAt.toISOString(),
    } : null };
  };
  const currentYear = await captureSequence(year);
  const nextYear = await captureSequence(year + 1);
  return JSON.stringify({
    passwordHashes,
    receiptSequence: { tenantId: ALLOWED_TENANT_ID, year, row: currentYear.row, nextYear },
  });
}

export function formatPrivateRecord(marker, payload) {
  if (typeof marker !== "string" || !/^__FINANCE_ACCEPTANCE_BASELINE_[a-f0-9]{32}__$/.test(marker)) {
    throw new Error("private baseline marker is invalid");
  }
  if (typeof payload !== "string" || /[\r\n]/.test(payload)) {
    throw new Error("private baseline record must be single-line text");
  }
  return `${marker}:${payload}`;
}

export function projectAcceptanceSeedPasswordHashes(baseline) {
  if (!Array.isArray(baseline?.passwordHashes)) throw new Error("acceptance seed password preimages are missing");
  return JSON.stringify(baseline.passwordHashes);
}

export function projectAcceptanceChildBaseline(baseline) {
  const receiptSequence = baseline?.receiptSequence;
  if (!receiptSequence || receiptSequence.tenantId !== ALLOWED_TENANT_ID || !Number.isInteger(receiptSequence.year) || !receiptSequence.nextYear || receiptSequence.nextYear.year !== receiptSequence.year + 1) {
    throw new Error("acceptance ReceiptSequence baseline is missing or invalid");
  }
  const projectRow = (row) => {
    if (row === null) return null;
    if (!row || typeof row.id !== "string" || !Number.isInteger(row.lastNumber) || typeof row.updatedAt !== "string") {
      throw new Error("acceptance ReceiptSequence row preimage is invalid");
    }
    return { id: row.id, lastNumber: row.lastNumber, updatedAt: row.updatedAt };
  };
  return JSON.stringify({
    receiptSequence: {
      tenantId: receiptSequence.tenantId,
      year: receiptSequence.year,
      row: projectRow(receiptSequence.row),
      nextYear: { year: receiptSequence.nextYear.year, row: projectRow(receiptSequence.nextYear.row) },
    },
  });
}

export async function restoreGoldenPasswordHashes(database, serializedSnapshot, seedPasswordHash) {
  if (seedPasswordHash !== undefined && seedPasswordHash !== null && (typeof seedPasswordHash !== "string" || !seedPasswordHash)) throw new Error("exact Golden seed password hash is invalid");
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
  let changed = false;
  await database.$transaction(async (transaction) => {
    for (const entry of snapshot) {
      const current = await transaction.user.findFirst({ where: { id: entry.id, email: entry.email } });
      if (current?.passwordHash !== entry.passwordHash) {
        const restored = seedPasswordHash && seedPasswordHash !== entry.passwordHash
          ? await transaction.user.updateMany({
            where: { id: entry.id, email: entry.email, passwordHash: seedPasswordHash },
            data: { passwordHash: entry.passwordHash },
          })
          : { count: 0 };
        if (restored.count !== 1) throw new Error("Golden password compare-and-set failed; concurrent hash preserved");
        changed = true;
      }
      const verified = await transaction.user.findFirst({ where: { id: entry.id, email: entry.email } });
      if (verified?.passwordHash !== entry.passwordHash) {
        throw new Error("Golden password baseline restore verification failed");
      }
    }
  });
  return changed ? "restored" : "unchanged";
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
  const receiptFileIds = new Set();
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
    if (object.tenantId !== tenantId || !isGenericDocumentObjectKey(objectKey, tenantId)) {
      throw new Error("storage object is outside the fixed tenant");
    }
    const identity = `${bucket}\0${objectKey}\0${objectVersionId}`;
    const previous = objects.get(identity);
    if (previous && previous.fileId && fileId && previous.fileId !== fileId) throw new Error("storage object identity has conflicting File owners");
    objects.set(identity, { bucket, objectKey, objectVersionId, fileId: fileId ?? previous?.fileId ?? null });
  };

  const registerReceiptObject = (payment, document, file) => {
    if (!payment || !resources.payment.has(payment.id) || payment.tenantId !== tenantId || payment.buildingId !== buildingId) {
      throw new Error("receipt Payment is not the exact registered Golden Payment");
    }
    const receiptDocumentId = requireIdentity(payment.receiptDocumentId, "receipt Document id");
    const receiptNumber = requireIdentity(payment.receiptNumber, "receipt number");
    if (!/^R-[A-Z0-9]+-\d{4}-\d{6}$/.test(receiptNumber)) {
      throw new Error("receipt number is not canonical");
    }
    if (document?.id !== receiptDocumentId || document.tenantId !== tenantId || document.buildingId !== buildingId) {
      throw new Error("receipt Document ownership or Payment binding mismatch");
    }
    const fileId = requireIdentity(document.fileId, "receipt Document File id");
    if (file?.id !== fileId || file.tenantId !== tenantId) {
      throw new Error("receipt File ownership or Document binding mismatch");
    }
    const bucket = requireIdentity(file.bucket, "receipt storage bucket");
    const objectKey = requireIdentity(file.objectKey, "receipt storage key");
    const objectVersionId = requireIdentity(file.objectVersionId, "receipt storage version");
    const expectedKey = `tenant/${tenantId}/payments/${payment.id}/receipts/${receiptNumber}.pdf`;
    if (objectKey !== expectedKey) throw new Error("receipt storage key does not match the exact Payment receipt");

    if (!resources.document.has(document.id)) register("document", document);
    if (!resources.file.has(file.id)) register("file", file);
    receiptFileIds.add(file.id);
    const identity = `${bucket}\0${objectKey}\0${objectVersionId}`;
    const previous = objects.get(identity);
    if (previous && previous.fileId && previous.fileId !== file.id) {
      throw new Error("receipt storage identity has conflicting File owners");
    }
    objects.set(identity, { bucket, objectKey, objectVersionId, fileId: file.id });
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
    const isPreimage = (preimage, year) => preimage?.year === year && (
      preimage.row === null || (
        preimage.row && typeof preimage.row.id === "string" && Number.isInteger(preimage.row.lastNumber) &&
        typeof preimage.row.updatedAt === "string"
      )
    );
    const captured = [
      isPreimage(snapshot, snapshot.year) ? { year: snapshot.year, row: snapshot.row } : null,
      isPreimage(snapshot.nextYear, snapshot.year + 1) ? snapshot.nextYear : null,
    ].filter(Boolean);
    if (captured.length !== 2) throw new Error("next-year receipt sequence preimage is missing");
    const receiptNumbers = [...new Set([...resources.payment.keys()].flatMap((id) => {
      const payment = paymentRowsById.get(id);
      return typeof payment?.receiptNumber === "string" ? [payment.receiptNumber] : [];
    }))];
    if (receiptNumbers.length > 1) throw new Error("acceptance run reserved more than one receipt number");
    const [receiptNumber] = receiptNumbers;
    const match = receiptNumber?.match(/^R-[A-Z0-9]+-(\d{4})-(\d{6})$/);
    const receiptYear = match ? Number(match[1]) : null;
    if (receiptNumber && (!match || !captured.some(({ year }) => year === receiptYear))) {
      throw new Error("acceptance receipt number does not match a captured private sequence preimage");
    }
    const assertUnchanged = async ({ year, row }, context = "without a receipt number") => {
      const current = await prisma.receiptSequence.findUnique({ where: { tenantId_year: { tenantId, year } } });
      if (row === null ? current !== null : !current || current.id !== row.id || current.lastNumber !== row.lastNumber || current.updatedAt.toISOString() !== row.updatedAt) {
        throw new Error(`receipt sequence changed from its captured baseline ${context}`);
      }
    };
    if (!receiptNumber) {
      for (const preimage of captured) await assertUnchanged(preimage);
      return "unchanged";
    }
    const preimage = captured.find(({ year }) => year === receiptYear);
    if (!preimage) throw new Error("receipt year has no captured sequence preimage");
    const { year, row: original } = preimage;
    const current = await prisma.receiptSequence.findUnique({
      where: { tenantId_year: { tenantId, year } },
    });
    const reservedNumber = Number(match[2]);
    if (original === null) {
      if (!current || reservedNumber !== 1 || current.lastNumber !== reservedNumber) {
        throw new Error("receipt sequence is no longer at the exact run-owned first number");
      }
      const result = await prisma.receiptSequence.deleteMany({ where: { id: current.id, tenantId, year, lastNumber: reservedNumber } });
      if (result.count !== 1) throw new Error("run-created receipt sequence could not be removed exactly");
      const remaining = await prisma.receiptSequence.findUnique({ where: { tenantId_year: { tenantId, year } } });
      if (remaining) throw new Error("run-created receipt sequence remains after cleanup");
      for (const other of captured.filter(({ year: capturedYear }) => capturedYear !== year)) await assertUnchanged(other, "after receipt-year restoration");
      return "restored";
    }
    if (!current || current.id !== original.id || reservedNumber !== original.lastNumber + 1 || current.lastNumber !== reservedNumber) {
      throw new Error("receipt sequence advanced concurrently; refusing to rewind shared numbering");
    }
    const result = await prisma.receiptSequence.updateMany({
      where: { id: current.id, tenantId, year, lastNumber: reservedNumber, updatedAt: current.updatedAt },
      data: { lastNumber: original.lastNumber, updatedAt: new Date(original.updatedAt) },
    });
    if (result.count !== 1) throw new Error("receipt sequence compare-and-set restoration failed");
    const restored = await prisma.receiptSequence.findUnique({ where: { tenantId_year: { tenantId, year } } });
    if (!restored || restored.id !== original.id || restored.lastNumber !== original.lastNumber || restored.updatedAt.toISOString() !== original.updatedAt) {
      throw new Error("receipt sequence baseline restoration could not be verified");
    }
    for (const other of captured.filter(({ year: capturedYear }) => capturedYear !== year)) await assertUnchanged(other, "after receipt-year restoration");
    return "restored";
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
      if (receiptId || currentPayment?.receiptNumber) {
        await attempt(async () => {
          if (!receiptId || !currentPayment.receiptNumber) {
            throw new Error("exact Payment receipt identity is incomplete");
          }
          const document = await prisma.document.findFirst({ where: { id: receiptId } });
          if (!document) throw new Error("exact Payment receipt Document is missing");
          if (document.tenantId !== tenantId || document.buildingId !== buildingId || typeof document.fileId !== "string" || !document.fileId) {
            throw new Error("exact Payment receipt Document binding is invalid");
          }
          const file = await prisma.file.findFirst({ where: { id: document.fileId } });
          if (!file) throw new Error("exact Payment receipt File is missing");
          registerReceiptObject(currentPayment, document, file);
        });
      }
    }

    for (const row of await exactRegisteredRows("document", prisma.document)) {
      const file = await prisma.file.findFirst({ where: { id: row.fileId } });
      if (file && file.tenantId !== tenantId) throw new Error("Document File ownership mismatch");
      if (file && !resources.file.has(file.id)) register("file", file);
      if (file && typeof file.objectVersionId === "string" && file.objectVersionId.length) {
        if (!receiptFileIds.has(file.id)) {
          registerObject({ ...file, fileId: file.id, objectVersionId: file.objectVersionId });
        }
      }
    }

    for (const object of objects.values()) await attempt(async () => {
      if (object.fileId !== null) {
        const file = await prisma.file.findFirst({ where: { id: object.fileId } });
        if (file && (file.id !== object.fileId || file.tenantId !== tenantId || file.bucket !== object.bucket || file.objectKey !== object.objectKey || file.objectVersionId !== object.objectVersionId)) {
          throw new Error("storage identity no longer matches its registered File");
        }
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
    let receiptSequenceProof;
    if (errors.length === 0) {
      try { receiptSequenceProof = await restoreReceiptSequence(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, `acceptance cleanup failed for run ${runId}: ${errors.map((error) => error instanceof Error ? error.message : "unknown cleanup error").join("; ")}`);
    onPass(receiptSequenceProof === "unchanged" ? "QA_RECEIPT_SEQUENCE_BASELINE_UNCHANGED_PASS" : "QA_RECEIPT_SEQUENCE_RESTORE_PASS");
    onPass("QA_RECEIPT_SEQUENCE_BASELINE_PROOF_PASS");
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
