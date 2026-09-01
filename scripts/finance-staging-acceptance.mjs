import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const tenantId = "stg-golden-tenant-auto";
const buildingId = "stg-golden-building-auto";
const unitId = "stg-golden-unit-auto-102";
const qaEmail = "admin.autogestionada@staging.buildingos.local";
const password = process.env.STAGING_GOLDEN_QA_PASSWORD;
const apiBaseUrl =
  process.env.FINANCE_ACCEPTANCE_API_BASE_URL ?? "http://buildingos-api:3000";
const runId = process.env.FINANCE_ACCEPTANCE_RUN_ID;
const marker = `FIN-02C-STAGING:${runId}`;
const acceptanceDate = new Date().toISOString().slice(0, 10);
const prisma = new PrismaClient();
const tempDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "finance-02c-auth-"),
);
const cookiePath = path.join(tempDirectory, "cookies");

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readCookies() {
  try {
    return fs.readFileSync(cookiePath, "utf8");
  } catch {
    return "";
  }
}

function persistCookies(values) {
  fs.writeFileSync(cookiePath, values.join("; "), { mode: 0o600 });
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(method, requestPath, body) {
  const headers = { accept: "application/json", "x-tenant-id": tenantId };
  const cookies = readCookies();
  if (cookies) headers.cookie = cookies;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${apiBaseUrl}${requestPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await parseResponse(response);
  if (!response.ok) {
    fail(`${method} ${requestPath} returned HTTP ${response.status}`);
  }
  return payload;
}

async function expectRejected(method, requestPath, body) {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "x-tenant-id": tenantId,
  };
  const cookies = readCookies();
  if (cookies) headers.cookie = cookies;
  const response = await fetch(`${apiBaseUrl}${requestPath}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  await response.arrayBuffer();
  assert(!response.ok, `${method} ${requestPath} unexpectedly succeeded`);
}

async function login() {
  assert(
    typeof password === "string" && password.length >= 12,
    "Golden QA password is unavailable",
  );
  assert(
    typeof runId === "string" && runId.length > 0,
    "acceptance run identity is unavailable",
  );
  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenantId },
    body: JSON.stringify({ email: qaEmail, password }),
  });
  const payload = await parseResponse(response);
  if (!response.ok) fail(`POST /auth/login returned HTTP ${response.status}`);
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];
  const values = [];
  for (const cookie of setCookies) {
    for (const match of cookie.matchAll(/(bo_(?:access|refresh)_token=[^;,]+)/g)) {
      values.push(match[1]);
    }
  }
  assert(
    values.length === 2,
    "staging login did not issue both temporary auth cookies",
  );
  persistCookies(values);
  const memberships = Array.isArray(payload?.memberships)
    ? payload.memberships
    : [];
  const activeMembership = memberships.find(
    (membership) => membership.tenantId === tenantId,
  );
  assert(
    activeMembership,
    "Golden QA account did not resolve to the allowlisted tenant",
  );
  assert(
    activeMembership.roles?.includes("TENANT_ADMIN"),
    "Golden QA account lacks TENANT_ADMIN role",
  );
  assert(
    memberships.every(
      (membership) =>
        typeof membership.tenantId === "string" &&
        membership.tenantId.startsWith("stg-golden-"),
    ),
    "login returned a non-Golden tenant",
  );
  const profile = await request("GET", "/auth/me");
  assert(
    profile?.memberships?.some(
      (membership) => membership.tenantId === tenantId,
    ),
    "authenticated session has no allowlisted tenant context",
  );
  console.log("login=PASS");
  console.log("authenticated_tenant=stg-golden-tenant-auto");
}

async function findFinanceCategories() {
  const categories = await prisma.expenseLedgerCategory.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, movementType: true, catalogScope: true },
  });
  const expenseCategory = categories.find(
    (category) =>
      category.movementType === "EXPENSE" &&
      category.catalogScope === "BUILDING",
  );
  const incomeCategory = categories.find(
    (category) => category.movementType === "INCOME",
  );
  assert(
    expenseCategory,
    "Golden tenant has no active BUILDING expense category",
  );
  assert(incomeCategory, "Golden tenant has no active income category");
  return {
    expenseCategoryId: expenseCategory.id,
    incomeCategoryId: incomeCategory.id,
  };
}

async function acceptExpense(expenseCategoryId, period) {
  const invalidDescription = `${marker}:expense-invalid`;
  await expectRejected("POST", `/tenants/${tenantId}/finance/expenses`, {
    buildingId,
    period,
    categoryId: `stg-golden-invalid-category-${runId}`,
    amountMinor: 1001,
    currencyCode: "ARS",
    invoiceDate: `${acceptanceDate}T12:00:00.000Z`,
    description: invalidDescription,
  });
  const invalidCount = await prisma.expense.count({
    where: { tenantId, description: invalidDescription },
  });
  assert(
    invalidCount === 0,
    "failed Expense request left a partial financial record",
  );

  const expense = await request(
    "POST",
    `/tenants/${tenantId}/finance/expenses`,
    {
      buildingId,
      period,
      categoryId: expenseCategoryId,
      amountMinor: 1001,
      currencyCode: "ARS",
      invoiceDate: `${acceptanceDate}T12:00:00.000Z`,
      description: `${marker}:expense`,
    },
  );
  assert(
    expense?.tenantId === tenantId && expense?.status === "DRAFT",
    "Expense did not persist as a Golden DRAFT",
  );
  const updated = await request(
    "PATCH",
    `/tenants/${tenantId}/finance/expenses/${expense.id}`,
    {
      description: `${marker}:expense-updated`,
    },
  );
  assert(
    updated?.id === expense.id && updated?.status === "DRAFT",
    "Expense DRAFT update failed",
  );
  const persisted = await prisma.expense.findUnique({
    where: { id: expense.id },
    select: { tenantId: true, status: true, description: true },
  });
  assert(
    persisted?.tenantId === tenantId &&
      persisted.status === "DRAFT" &&
      persisted.description === `${marker}:expense-updated`,
    "Expense persistence is inconsistent",
  );
  console.log("expense_atomic_flow=PASS");
  return expense.id;
}

async function acceptIncome(incomeCategoryId, period) {
  const invalidDescription = `${marker}:income-invalid`;
  await expectRejected("POST", `/tenants/${tenantId}/finance/incomes`, {
    buildingId,
    period,
    categoryId: `stg-golden-invalid-income-category-${runId}`,
    amountMinor: 1002,
    currencyCode: "ARS",
    receivedDate: `${acceptanceDate}T12:00:00.000Z`,
    description: invalidDescription,
  });
  const invalidCount = await prisma.income.count({
    where: { tenantId, description: invalidDescription },
  });
  assert(
    invalidCount === 0,
    "failed Income request left a partial financial record",
  );

  const income = await request("POST", `/tenants/${tenantId}/finance/incomes`, {
    buildingId,
    period,
    categoryId: incomeCategoryId,
    amountMinor: 1002,
    currencyCode: "ARS",
    receivedDate: `${acceptanceDate}T12:00:00.000Z`,
    description: `${marker}:income`,
  });
  assert(
    income?.tenantId === tenantId && income?.status === "DRAFT",
    "Income did not persist as a Golden DRAFT",
  );
  const persisted = await prisma.income.findUnique({
    where: { id: income.id },
    select: { tenantId: true, status: true, description: true },
  });
  assert(
    persisted?.tenantId === tenantId &&
      persisted.status === "DRAFT" &&
      persisted.description === `${marker}:income`,
    "Income persistence is inconsistent",
  );
  console.log("income_atomic_flow=PASS");
  return income.id;
}

async function createPaymentProof() {
  const proof = Buffer.from("%PDF-1.4\n% FIN-02C-STAGING\n", "utf8");
  const originalName = `fin-02c-${runId}.pdf`;
  const checksum = crypto.createHash("sha256").update(proof).digest("hex");
  const presign = await request(
    "POST",
    `/tenants/${tenantId}/documents/presign`,
    {
      originalName,
      mimeType: "application/pdf",
      size: proof.length,
      purpose: "PAYMENT_PROOF",
    },
  );
  assert(
    typeof presign?.url === "string" && typeof presign?.objectKey === "string",
    "payment proof presign response is incomplete",
  );
  const upload = await fetch(presign.url, {
    method: "PUT",
    headers: { "content-type": "application/pdf" },
    body: proof,
  });
  await upload.arrayBuffer();
  assert(upload.ok, "payment proof upload failed");
  const document = await request("POST", `/tenants/${tenantId}/documents`, {
    title: `${marker}:payment-proof`,
    category: "RECEIPT",
    visibility: "TENANT_ADMINS",
    buildingId,
    unitId,
    file: {
      objectKey: presign.objectKey,
      originalName,
      mimeType: "application/pdf",
      size: proof.length,
      checksum,
    },
  });
  assert(
    document?.id && document?.file?.id,
    "payment proof document response is incomplete",
  );
  return document.file.id;
}

async function waitForReceipt(paymentId) {
  let payment;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    payment = await request(
      "GET",
      `/buildings/${buildingId}/payments/${paymentId}`,
    );
    if (payment.status === "RECONCILED" && payment.receiptStatus === "READY")
      return payment;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  fail(`payment ${paymentId} did not reach RECONCILED and READY receipt state`);
}

async function inspectReceipt(payment) {
  const persisted = await prisma.payment.findUnique({
    where: { id: payment.id },
    select: {
      id: true,
      tenantId: true,
      buildingId: true,
      unitId: true,
      amount: true,
      currency: true,
      status: true,
      receiptStatus: true,
      receiptNumber: true,
      receiptDocumentId: true,
      receiptGeneratedAt: true,
      receiptSnapshot: true,
      receiptSnapshotVersion: true,
      receiptSnapshotHash: true,
      receiptSnapshotCreatedAt: true,
      receiptGenerationToken: true,
      receiptGenerationLeaseUntil: true,
    },
  });
  assert(
    persisted?.tenantId === tenantId &&
      persisted.buildingId === buildingId &&
      persisted.unitId === unitId,
    "payment tenant/building/unit scope is invalid",
  );
  assert(
    persisted.status === "RECONCILED" && persisted.receiptStatus === "READY",
    "payment receipt state is not complete",
  );
  assert(
    persisted.receiptNumber &&
      persisted.receiptDocumentId &&
      persisted.receiptGeneratedAt,
    "receipt identity is incomplete",
  );
  assert(
    persisted.receiptSnapshot &&
      persisted.receiptSnapshotVersion &&
      persisted.receiptSnapshotHash &&
      persisted.receiptSnapshotCreatedAt,
    "immutable receipt snapshot is incomplete",
  );
  assert(
    persisted.receiptGenerationToken === null &&
      persisted.receiptGenerationLeaseUntil === null,
    "receipt generation lease was not cleared",
  );

  const documentCount = await prisma.document.count({
    where: { id: persisted.receiptDocumentId, tenantId },
  });
  const document = await prisma.document.findUnique({
    where: { id: persisted.receiptDocumentId },
    select: { id: true, tenantId: true, fileId: true },
  });
  const fileCount = document
    ? await prisma.file.count({ where: { id: document.fileId, tenantId } })
    : 0;
  assert(
    documentCount === 1 && fileCount === 1,
    "receipt Document/File cardinality is invalid",
  );

  const download = await request(
    "GET",
    `/tenants/${tenantId}/documents/${persisted.receiptDocumentId}/download`,
  );
  assert(
    typeof download?.url === "string",
    "receipt download response is incomplete",
  );
  const objectResponse = await fetch(download.url);
  const bytes = Buffer.from(await objectResponse.arrayBuffer());
  const contentType = objectResponse.headers.get("content-type") ?? "";
  assert(
    objectResponse.ok && bytes.length > 0,
    "receipt storage object is unreadable or empty",
  );
  assert(
    bytes.subarray(0, 5).toString("ascii") === "%PDF-",
    "receipt storage object is not a PDF",
  );
  assert(
    contentType.toLowerCase().includes("application/pdf"),
    "receipt storage content type is not application/pdf",
  );
  const file = await prisma.file.findUnique({
    where: { id: document.fileId },
    select: {
      bucket: true,
      objectKey: true,
      mimeType: true,
      size: true,
      checksum: true,
    },
  });
  assert(
    file?.mimeType === "application/pdf" && file.size === bytes.length,
    "receipt File metadata does not match storage object",
  );
  if (file.checksum) {
    assert(
      file.checksum === crypto.createHash("sha256").update(bytes).digest("hex"),
      "receipt File checksum does not match storage object",
    );
  }

  const audits = await prisma.paymentAuditLog.findMany({
    where: { tenantId, paymentId: payment.id },
    orderBy: { createdAt: "asc" },
    select: { action: true, paymentId: true, tenantId: true, createdAt: true },
  });
  const actions = audits.map((audit) => audit.action);
  assert(
    JSON.stringify(actions) ===
      JSON.stringify([
        "SUBMITTED",
        "APPROVED",
        "RECONCILED",
        "RECEIPT_GENERATED",
      ]),
    "payment audit sequence is not canonical",
  );
  assert(
    audits.every(
      (audit) => audit.paymentId === payment.id && audit.tenantId === tenantId,
    ),
    "payment audit scope is invalid",
  );
  assert(
    audits.every(
      (audit, index) =>
        index === 0 || audits[index - 1].createdAt <= audit.createdAt,
    ),
    "payment audit sequence is not chronological",
  );

  const allocations = await prisma.paymentAllocation.findMany({
    where: { tenantId, paymentId: payment.id },
    select: {
      id: true,
      amount: true,
      paymentId: true,
      chargeId: true,
      tenantId: true,
      charge: {
        select: {
          tenantId: true,
          buildingId: true,
          currency: true,
          status: true,
        },
      },
    },
  });
  assert(
    allocations.length === 1,
    "payment has duplicate or missing allocation",
  );
  const allocatedTotal = allocations.reduce(
    (total, allocation) => total + allocation.amount,
    0,
  );
  assert(allocatedTotal <= persisted.amount, "payment is over-allocated");
  assert(
    allocations.every(
      (allocation) =>
        allocation.tenantId === tenantId &&
        allocation.charge.tenantId === tenantId &&
        allocation.charge.buildingId === buildingId &&
        allocation.charge.currency === persisted.currency,
    ),
    "allocation tenant/building/currency relationship is invalid",
  );
  assert(
    allocations[0].charge.status === "PAID",
    "allocated charge is not PAID after reconciliation",
  );

  console.log("payment_submitted=PASS");
  console.log("payment_approved=PASS");
  console.log("payment_reconciled=PASS");
  console.log("receipt_generated=PASS");
  console.log("audit_sequence=PASS");
  console.log("allocation=PASS");
  console.log("receipt=PASS");
  console.log(`payment_id=${payment.id}`);
  console.log(`charge_id=${allocations[0].chargeId}`);
  console.log(`receipt_document_id=${persisted.receiptDocumentId}`);
  console.log(`receipt_file_id=${document.fileId}`);
  return { persisted, document, file, audits };
}

async function retryReceipt(paymentId, before) {
  const retry = await request(
    "POST",
    `/tenants/${tenantId}/finance/payments/${paymentId}/retry-receipt`,
  );
  assert(
    retry?.success === true && retry.receiptNumber === before.receiptNumber,
    "completed receipt retry did not reuse receipt identity",
  );
  const after = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      receiptNumber: true,
      receiptDocumentId: true,
      receiptGeneratedAt: true,
      receiptSnapshot: true,
      receiptSnapshotHash: true,
      receiptGenerationToken: true,
      receiptGenerationLeaseUntil: true,
    },
  });
  assert(
    after?.receiptNumber === before.receiptNumber &&
      after.receiptDocumentId === before.receiptDocumentId,
    "receipt retry changed persisted identity",
  );
  assert(
    after.receiptGeneratedAt?.toISOString() ===
      before.receiptGeneratedAt?.toISOString(),
    "receipt retry changed generatedAt",
  );
  assert(
    JSON.stringify(after.receiptSnapshot) ===
      JSON.stringify(before.receiptSnapshot) &&
      after.receiptSnapshotHash === before.receiptSnapshotHash,
    "receipt retry changed immutable snapshot",
  );
  assert(
    after.receiptGenerationToken === null &&
      after.receiptGenerationLeaseUntil === null,
    "receipt retry left a generation lease",
  );
  const documentCount = await prisma.document.count({
    where: { id: before.receiptDocumentId, tenantId },
  });
  const fileCount = before.document
    ? await prisma.file.count({
        where: { id: before.document.fileId, tenantId },
      })
    : 0;
  const auditCount = await prisma.paymentAuditLog.count({
    where: { tenantId, paymentId, action: "RECEIPT_GENERATED" },
  });
  assert(
    documentCount === 1 && fileCount === 1 && auditCount === 1,
    "receipt retry created duplicate evidence",
  );
  console.log("receipt_retry_idempotent=PASS");
}

async function databaseIntegrity(payment, chargeId) {
  const allocationRows = await prisma.paymentAllocation.findMany({
    where: { tenantId, paymentId: payment.id },
    select: { paymentId: true, chargeId: true, amount: true },
  });
  assert(
    allocationRows.every(
      (row) => row.paymentId === payment.id && row.chargeId === chargeId,
    ),
    "orphan allocation detected",
  );
  assert(
    allocationRows.reduce((total, row) => total + row.amount, 0) <=
      payment.amount,
    "over-allocation detected",
  );
  const charge = await prisma.charge.findUnique({
    where: { id: chargeId },
    select: {
      tenantId: true,
      buildingId: true,
      unitId: true,
      period: true,
      concept: true,
      currency: true,
    },
  });
  assert(
    charge?.tenantId === tenantId &&
      charge.buildingId === buildingId &&
      charge.unitId === unitId &&
      charge.currency === payment.currency,
    "charge tenant/building/unit/currency relationship is invalid",
  );
  const chargeKeyCount = await prisma.charge.count({
    where: {
      tenantId,
      unitId,
      period: charge.period,
      concept: `${marker}:charge`,
    },
  });
  assert(chargeKeyCount === 1, "duplicate canonical charge key detected");
  assert(payment.currency === "ARS", "payment currency mismatch");
  const receiptAuditCount = await prisma.paymentAuditLog.count({
    where: { tenantId, paymentId: payment.id, action: "RECEIPT_GENERATED" },
  });
  assert(receiptAuditCount === 1, "duplicate RECEIPT_GENERATED audit detected");
  const leaseCount = await prisma.payment.count({
    where: {
      tenantId,
      id: payment.id,
      OR: [
        { receiptGenerationToken: { not: null } },
        { receiptGenerationLeaseUntil: { not: null } },
      ],
    },
  });
  assert(leaseCount === 0, "stuck receipt generation lease detected");
  console.log("integrity_orphan_allocations=0");
  console.log("integrity_over_allocations=0");
  console.log("integrity_duplicate_charge_keys=0");
  console.log("integrity_currency_mismatch=0");
  console.log("integrity_duplicate_receipt_files=0");
  console.log("integrity_duplicate_receipt_documents=0");
  console.log("integrity_duplicate_receipt_audits=0");
  console.log("integrity_stuck_leases=0");
}

async function main() {
  assert(
    apiBaseUrl === "http://buildingos-api:3000",
    "acceptance API must be the internal staging API",
  );
  assert(
    tenantId.startsWith("stg-golden-") &&
      buildingId.startsWith("stg-golden-") &&
      unitId.startsWith("stg-golden-"),
    "acceptance identifiers are not Golden-scoped",
  );
  await login();
  const period = new Date().toISOString().slice(0, 7);
  const categories = await findFinanceCategories();
  const expenseId = await acceptExpense(categories.expenseCategoryId, period);
  const incomeId = await acceptIncome(categories.incomeCategoryId, period);
  const charge = await request("POST", `/buildings/${buildingId}/charges`, {
    unitId,
    type: "COMMON_EXPENSE",
    concept: `${marker}:charge`,
    amount: 12345,
    currency: "ARS",
    period,
    dueDate: `${period}-10T00:00:00.000Z`,
  });
  assert(
    charge?.id && charge?.tenantId === tenantId,
    "synthetic charge creation failed",
  );
  const proofFileId = await createPaymentProof();
  const payment = await request("POST", `/buildings/${buildingId}/payments`, {
    unitId,
    chargeId: charge.id,
    chargeIds: [charge.id],
    amount: 12345,
    currency: "ARS",
    method: "TRANSFER",
    reference: `${marker}:payment`,
    proofFileId,
    transferDate: acceptanceDate,
  });
  assert(
    payment?.id &&
      payment.status === "SUBMITTED" &&
      payment.tenantId === tenantId,
    "synthetic payment was not SUBMITTED in the allowlisted tenant",
  );
  const approved = await request(
    "PATCH",
    `/tenants/${tenantId}/finance/payments/${payment.id}/approve`,
    { paidAt: new Date().toISOString() },
  );
  assert(
    approved?.id === payment.id && approved.status === "RECONCILED",
    "payment approval did not reconcile through the application flow",
  );
  const completed = await waitForReceipt(payment.id);
  const receipt = await inspectReceipt(completed);
  await retryReceipt(payment.id, receipt.persisted);
  const finalPayment = await prisma.payment.findUnique({
    where: { id: payment.id },
    select: { id: true, amount: true, currency: true },
  });
  assert(finalPayment, "synthetic payment disappeared after retry");
  await databaseIntegrity(finalPayment, charge.id);
  console.log(`expense_id=${expenseId}`);
  console.log(`income_id=${incomeId}`);
  console.log(`tenant_id=${tenantId}`);
  console.log(`building_id=${buildingId}`);
  console.log("gateway_mutations=0");
}

try {
  await main();
} catch (error) {
  console.error(
    `FINANCE_02C_ACCEPTANCE_FAILED: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
