import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { PrismaClient, Prisma, ChargeType, ChargeStatus, PaymentStatus, ReceiptStatus } from '@prisma/client';

import { login, TEST_USERS } from '../helpers/auth';
import {
  ReceiptTeardownFailedError,
  ReceiptTeardownTimeoutError,
  teardownPaymentReceipts,
  throwReceiptTeardownFailures,
  type ReceiptTeardownDocument,
  type ReceiptTeardownPayment,
} from './receipt-teardown';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000';
const PRISMA = new PrismaClient();
const TEST_REFERENCE = 'E2E-FIN-01';
const AUGUST_PAYMENT_REFERENCE = `${TEST_REFERENCE}-AUG`;
const PAYMENT_REFERENCES = [TEST_REFERENCE, AUGUST_PAYMENT_REFERENCE] as const;
const FIAT_PERIODS = ['2026-06', '2026-07', '2026-08'] as const;
const E2E_CHARGE_CONCEPTS = [
  `${TEST_REFERENCE} - Expensas Junio 2026`,
  `${TEST_REFERENCE} - Expensas Julio 2026`,
  `${TEST_REFERENCE} - Expensas Agosto 2026`,
  `${TEST_REFERENCE} - Expensas Unidad Vecina`,
] as const;
const E2E_PROOF_FILENAMES = ['proof.pdf', 'proof-august.pdf'] as const;
const RECEIPT_POLL_TIMEOUT_MS = 30_000;
const RECEIPT_CLEANUP_MANIFEST_DIRECTORY = resolve(
  __dirname,
  '../../../test-results/receipt-cleanup-verification',
);

/**
 * Deterministic relative dates: overdue semantics (dueDate < now) must not
 * depend on the calendar day the CI run happens. Delinquency is
 * overdue-only, so fixtures that must be delinquent use a clear past date
 * and fixtures that must NOT be delinquent use a clear future date with a
 * wide margin (weeks, not minutes).
 */
function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const pastDate = (daysAgo: number): string => dateOffset(-daysAgo);
const futureDate = (daysFromNow: number): string => dateOffset(daysFromNow);

interface ResidentContextResponse {
  activeBuildingId: string | null;
  activeUnitId: string | null;
}

interface CreatedChargeResponse {
  id: string;
  unitId: string;
  period: string;
  amount: number;
  currency: string;
  concept: string;
}

interface UnitLedgerResponse {
  totals: {
    totalChargesByCurrency: Array<{ currency: string; amountMinor: number }>;
    totalPaidByCurrency: Array<{ currency: string; amountMinor: number }>;
    totalAllocatedByCurrency: Array<{ currency: string; amountMinor: number }>;
    balanceByCurrency: Array<{ currency: string; amountMinor: number }>;
  };
}

interface FinancialSummaryResponse {
  totalChargesByCurrency: Array<{ currency: string; amountMinor: number }>;
  totalPaidByCurrency: Array<{ currency: string; amountMinor: number }>;
  totalOutstandingByCurrency: Array<{ currency: string; amountMinor: number }>;
  delinquentUnitsCount: number;
}

interface E2EArtifactContext {
  tenantId: string;
  buildingId: string;
  unitId: string;
  chargeIds: string[];
  proofFileIds: string[];
  receiptDocuments: ReceiptDocumentArtifact[];
}

interface PaymentArtifact extends ReceiptTeardownPayment {
  reference: string | null;
  proofFileId: string | null;
  status: PaymentStatus;
  receiptStatus: ReceiptStatus;
}

type ReceiptDocumentArtifact = ReceiptTeardownDocument;

function arsAmount(buckets: Array<{ currency: string; amountMinor: number }> | undefined): number {
  return (buckets ?? []).find((b) => b.currency === 'ARS')?.amountMinor ?? 0;
}

async function getMeContext(page: Page, tenantId: string): Promise<ResidentContextResponse> {
  const response = await page.request.get(`${API_ORIGIN}/me/context`, {
    headers: {
      'X-Tenant-Id': tenantId,
      Accept: 'application/json',
    },
  });

  expect(response.ok()).toBe(true);
  return (await response.json()) as ResidentContextResponse;
}

async function createCharge(
  page: Page,
  tenantId: string,
  buildingId: string,
  unitId: string,
  period: string,
  dueDate: string,
  concept: string,
  amount: number,
): Promise<CreatedChargeResponse> {
  const response = await page.request.post(`${API_ORIGIN}/buildings/${buildingId}/charges`, {
    headers: {
      'X-Tenant-Id': tenantId,
      'x-portal-context': 'admin',
      Accept: 'application/json',
    },
      data: {
        unitId,
        type: ChargeType.COMMON_EXPENSE,
        concept,
        amount,
        currency: 'ARS',
      period,
      dueDate,
    },
  });

  if (!response.ok()) {
    throw new Error(
      `Failed to create charge (${response.status()} ${response.statusText()}): ${await response.text()}`,
    );
  }
  return (await response.json()) as CreatedChargeResponse;
}

async function createPaymentProofDocument(
  _page: Page,
  tenantId: string,
  buildingId: string,
  unitId: string,
  fileName: string,
  mimeType: string,
  fileBytes: Buffer,
): Promise<string> {
  const file = await PRISMA.file.create({
    data: {
      tenantId,
      bucket: 'e2e-payments',
      objectKey: `e2e/payments/${TEST_REFERENCE}/${buildingId}/${unitId}/${fileName}`,
      originalName: fileName,
      mimeType,
      size: fileBytes.length,
      checksum: null,
      createdByMembershipId: null,
    },
    select: { id: true },
  });

  return file.id;
}

async function submitPaymentViaApi(
  page: Page,
  tenantId: string,
  buildingId: string,
  unitId: string,
  chargeIds: string[],
  amount: number,
  reference: string,
  proofFileId: string,
): Promise<void> {
  const response = await page.request.post(`${API_ORIGIN}/buildings/${buildingId}/payments`, {
    headers: {
      'X-Tenant-Id': tenantId,
      Accept: 'application/json',
    },
    data: {
      unitId,
      chargeIds,
      amount,
      currency: 'ARS',
      method: 'TRANSFER',
      reference,
      proofFileId,
    },
  });

  if (!response.ok()) {
    throw new Error(
      `Failed to submit payment (${response.status()} ${response.statusText()}): ${await response.text()}`,
    );
  }
}

async function approvePaymentViaApi(
  page: Page,
  tenantId: string,
  buildingId: string,
  paymentId: string,
): Promise<void> {
  const response = await page.request.patch(
    `${API_ORIGIN}/buildings/${buildingId}/payments/${paymentId}/approve`,
    {
      headers: {
        'X-Tenant-Id': tenantId,
        'x-portal-context': 'admin',
        Accept: 'application/json',
      },
      data: {},
    },
  );

  if (!response.ok()) {
    throw new Error(
      `Failed to approve payment (${response.status()} ${response.statusText()}): ${await response.text()}`,
    );
  }
}

async function rejectPaymentViaApi(
  page: Page,
  tenantId: string,
  buildingId: string,
  paymentId: string,
  reason: string,
): Promise<void> {
  const response = await page.request.patch(
    `${API_ORIGIN}/buildings/${buildingId}/payments/${paymentId}/reject`,
    {
      headers: {
        'X-Tenant-Id': tenantId,
        'x-portal-context': 'admin',
        Accept: 'application/json',
      },
      data: { reason },
    },
  );

  if (!response.ok()) {
    throw new Error(
      `Failed to reject payment (${response.status()} ${response.statusText()}): ${await response.text()}`,
    );
  }
}

async function getE2EPaymentArtifacts(
  tenantId: string,
  buildingId: string,
  unitId: string,
): Promise<PaymentArtifact[]> {
  return PRISMA.payment.findMany({
    where: {
      tenantId,
      buildingId,
      unitId,
      reference: { in: [...PAYMENT_REFERENCES] },
    },
    select: {
      id: true,
      reference: true,
      proofFileId: true,
      status: true,
      receiptStatus: true,
      receiptDocumentId: true,
    },
  });
}

async function captureReceiptDocument(
  tenantId: string,
  payment: PaymentArtifact,
): Promise<ReceiptDocumentArtifact> {
  if (payment.receiptStatus !== ReceiptStatus.READY || !payment.receiptDocumentId) {
    throw new Error(`Payment ${payment.id} has no ready receipt document`);
  }

  const document = await PRISMA.document.findFirst({
    where: {
      id: payment.receiptDocumentId,
      tenantId,
    },
    select: {
      id: true,
      file: {
        select: {
          id: true,
          bucket: true,
          objectKey: true,
        },
      },
    },
  });

  if (!document) {
    throw new Error(`Receipt document ${payment.receiptDocumentId} for payment ${payment.id} was not found`);
  }

  const [storageIdentity] = await PRISMA.$queryRaw<Array<{ objectVersionId: string | null }>>(
    Prisma.sql`SELECT "objectVersionId" FROM "File" WHERE "id" = ${document.file.id}`,
  );
  const objectVersionId = storageIdentity?.objectVersionId?.trim();
  if (!objectVersionId) {
    throw new Error(`Receipt document ${document.id} for payment ${payment.id} has no exact storage version`);
  }

  return {
    paymentId: payment.id,
    documentId: document.id,
    fileId: document.file.id,
    bucket: document.file.bucket,
    objectKey: document.file.objectKey,
    objectVersionId,
  };
}

async function writeReceiptCleanupManifest(receipt: ReceiptDocumentArtifact): Promise<void> {
  if (!/^[A-Za-z0-9_-]+$/.test(receipt.documentId)) {
    throw new Error(`Receipt document ID ${receipt.documentId} is unsafe for a cleanup manifest path`);
  }

  await mkdir(RECEIPT_CLEANUP_MANIFEST_DIRECTORY, { recursive: true });

  const manifestPath = join(RECEIPT_CLEANUP_MANIFEST_DIRECTORY, `${receipt.documentId}.json`);
  const temporaryManifestPath = `${manifestPath}.${randomUUID()}.tmp`;
  const manifest = JSON.stringify({
    bucket: receipt.bucket,
    objectKey: receipt.objectKey,
    objectVersionId: receipt.objectVersionId,
  });

  await writeFile(temporaryManifestPath, manifest, 'utf8');
  await rename(temporaryManifestPath, manifestPath);
}

async function waitForPaymentReceipt(
  tenantId: string,
  buildingId: string,
  unitId: string,
  paymentId: string,
  reference: string,
): Promise<ReceiptDocumentArtifact> {
  let receipt: ReceiptDocumentArtifact | undefined;

  await expect.poll(
    async () => {
      const payment = await PRISMA.payment.findFirst({
        where: {
          id: paymentId,
          tenantId,
          buildingId,
          unitId,
          reference,
        },
        select: {
          id: true,
          reference: true,
          proofFileId: true,
          status: true,
          receiptStatus: true,
          receiptDocumentId: true,
        },
      });

      if (!payment) {
        throw new Error(`E2E payment ${paymentId} disappeared while waiting for receipt`);
      }
      if (payment.receiptStatus === ReceiptStatus.FAILED) {
        throw new ReceiptTeardownFailedError(paymentId);
      }
      if (payment.receiptStatus !== ReceiptStatus.READY || !payment.receiptDocumentId) {
        return false;
      }

      receipt = await captureReceiptDocument(tenantId, payment);
      return true;
    },
    { timeout: RECEIPT_POLL_TIMEOUT_MS, intervals: [250, 500, 1_000] },
  ).toBe(true);

  if (!receipt) {
    throw new Error(`Receipt for payment ${paymentId} was not captured`);
  }

  return receipt;
}

async function verifyReceiptStorageVersion(
  page: Page,
  tenantId: string,
  receipt: ReceiptDocumentArtifact,
): Promise<void> {
  const response = await page.request.get(
    `${API_ORIGIN}/tenants/${tenantId}/documents/${receipt.documentId}/download`,
    {
      headers: {
        'X-Tenant-Id': tenantId,
        'x-portal-context': 'admin',
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok()) {
    throw new Error(
      `Failed to create a download URL for receipt document ${receipt.documentId} ` +
        `(${response.status()} ${response.statusText()}): ${await response.text()}`,
    );
  }

  const payload = (await response.json()) as { url?: unknown };
  if (typeof payload.url !== 'string') {
    throw new Error(`Receipt document ${receipt.documentId} download URL was missing`);
  }

  const storageUrl = new URL(payload.url);
  expect(storageUrl.searchParams.get('versionId')).toBe(receipt.objectVersionId);

  const storageResponse = await page.request.get(storageUrl.toString());
  expect(storageResponse.ok()).toBe(true);
  expect(storageResponse.headers()['x-amz-version-id']).toBe(receipt.objectVersionId);
}

async function deleteReceiptDocumentViaApi(
  page: Page,
  tenantId: string,
  receipt: ReceiptDocumentArtifact,
): Promise<void> {
  const response = await page.request.delete(
    `${API_ORIGIN}/tenants/${tenantId}/documents/${receipt.documentId}`,
    {
      headers: {
        'X-Tenant-Id': tenantId,
        'x-portal-context': 'admin',
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok()) {
    throw new Error(
      `Failed to delete receipt document ${receipt.documentId} for payment ${receipt.paymentId} ` +
        `(${response.status()} ${response.statusText()}): ${await response.text()}`,
    );
  }
}

async function clearE2EArtifacts(page: Page, fixture: E2EArtifactContext): Promise<void> {
  const { tenantId, buildingId, unitId } = fixture;
  const payments = await getE2EPaymentArtifacts(tenantId, buildingId, unitId);
  const paymentCleanup = await teardownPaymentReceipts(fixture, payments, {
    waitForReceipt: async (payment) => {
      if (!payment.reference) {
        throw new Error(`E2E payment ${payment.id} has no reference`);
      }
      try {
        return await waitForPaymentReceipt(tenantId, buildingId, unitId, payment.id, payment.reference);
      } catch (error: unknown) {
        if (error instanceof ReceiptTeardownFailedError) {
          throw error;
        }
        throw new ReceiptTeardownTimeoutError(payment.id, error);
      }
    },
    unlinkReceiptDocument: async (receipt) => {
      const result = await PRISMA.payment.updateMany({
        where: {
          id: receipt.paymentId,
          tenantId,
          buildingId,
          unitId,
          receiptDocumentId: receipt.documentId,
        },
        data: { receiptDocumentId: null },
      });
      if (result.count !== 1) {
        throw new Error(`Receipt document ${receipt.documentId} is no longer owned by payment ${receipt.paymentId}`);
      }
    },
    restoreReceiptDocument: async (receipt) => {
      const result = await PRISMA.payment.updateMany({
        where: { id: receipt.paymentId, tenantId, buildingId, unitId, receiptDocumentId: null },
        data: { receiptDocumentId: receipt.documentId },
      });
      if (result.count !== 1) {
        throw new Error(`Receipt document ${receipt.documentId} relation could not be restored for payment ${receipt.paymentId}`);
      }
    },
    writeReceiptCleanupManifest,
    deleteReceiptDocument: async (receipt) => deleteReceiptDocumentViaApi(page, tenantId, receipt),
    deletePaymentAllocations: async (paymentIds) => {
      await PRISMA.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
    },
    deletePayments: async (paymentIds) => {
      await PRISMA.payment.deleteMany({
        where: { id: { in: paymentIds }, tenantId, buildingId, unitId },
      });
    },
  });

  if (paymentCleanup.hasPreservedPayments) {
    throwReceiptTeardownFailures(paymentCleanup.failures);
    throw new Error('E2E payment cleanup preserved a payment without reporting a failure');
  }

  const proofFileIds = new Set([
    ...fixture.proofFileIds,
    ...payments.flatMap((payment) => (payment.proofFileId ? [payment.proofFileId] : [])),
  ]);
  const knownProofObjectKeys = E2E_PROOF_FILENAMES.map(
    (fileName) => `e2e/payments/${TEST_REFERENCE}/${buildingId}/${unitId}/${fileName}`,
  );
  const residualProofFiles = await PRISMA.file.findMany({
    where: {
      tenantId,
      objectKey: { in: knownProofObjectKeys },
    },
    select: { id: true },
  });

  for (const file of residualProofFiles) {
    proofFileIds.add(file.id);
  }

  if (proofFileIds.size > 0) {
    await PRISMA.file.deleteMany({
      where: { id: { in: [...proofFileIds] }, tenantId },
    });
  }

  const residualCharges = await PRISMA.charge.findMany({
    where: {
      tenantId,
      buildingId,
      concept: { in: [...E2E_CHARGE_CONCEPTS] },
    },
    select: { id: true },
  });
  const chargeIds = new Set([...fixture.chargeIds, ...residualCharges.map((charge) => charge.id)]);

  if (chargeIds.size > 0) {
    await PRISMA.paymentAllocation.deleteMany({
      where: { chargeId: { in: [...chargeIds] } },
    });
    await PRISMA.charge.deleteMany({
      where: { id: { in: [...chargeIds] }, tenantId, buildingId },
    });
  }

  throwReceiptTeardownFailures(paymentCleanup.failures);
}

async function getUnitLedger(page: Page, tenantId: string, unitId: string): Promise<UnitLedgerResponse> {
  const response = await page.request.get(`${API_ORIGIN}/units/${unitId}/ledger?periodFrom=2026-06&periodTo=2026-08`, {
    headers: {
      'X-Tenant-Id': tenantId,
      Accept: 'application/json',
    },
  });

  expect(response.ok()).toBe(true);
  return (await response.json()) as UnitLedgerResponse;
}

async function getBuildingSummary(page: Page, tenantId: string, buildingId: string): Promise<FinancialSummaryResponse> {
  const response = await page.request.get(`${API_ORIGIN}/buildings/${buildingId}/finance/summary?period=2026-08`, {
    headers: {
      'X-Tenant-Id': tenantId,
      'x-portal-context': 'admin',
      Accept: 'application/json',
    },
  });

  expect(response.ok()).toBe(true);
  return (await response.json()) as FinancialSummaryResponse;
}

async function getTenantDelinquencyCount(page: Page, tenantId: string, buildingId: string): Promise<number> {
  const response = await page.request.get(
    `${API_ORIGIN}/buildings/${buildingId}/finance/delinquency?period=2026-08&page=1&pageSize=25`,
    {
      headers: {
        'X-Tenant-Id': tenantId,
        'x-portal-context': 'admin',
        Accept: 'application/json',
      },
    },
  );

  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { total: number };
  return payload.total;
}

async function fetchPaymentByReference(
  tenantId: string,
  buildingId: string,
  unitId: string,
  reference: string,
): Promise<{
  id: string;
  status: PaymentStatus;
  amount: number;
  paymentAllocations: Array<{
    chargeId: string;
    amount: number;
    charge: { id: string; period: string; concept: string };
  }>;
}> {
  const payment = await PRISMA.payment.findFirst({
    where: { tenantId, buildingId, unitId, reference },
    include: {
      paymentAllocations: {
        include: {
          charge: true,
        },
      },
    },
  });

  expect(payment).toBeTruthy();
  if (!payment) {
    throw new Error(`Expected payment with reference ${reference}`);
  }

  return payment as typeof payment & {
    paymentAllocations: Array<{
      chargeId: string;
      amount: number;
      charge: { id: string; period: string; concept: string };
    }>;
  };
}

test.describe('Resident finance oldest-first flow', () => {
  let fixtureContext: E2EArtifactContext | undefined;

  test.afterEach(async ({ page }) => {
    const fixture = fixtureContext;
    if (!fixture) {
      return;
    }

    try {
      const cleanupTenantId = await login(page, TEST_USERS.tenantAdminB);
      expect(cleanupTenantId).toBe(fixture.tenantId);
      try {
        await clearE2EArtifacts(page, fixture);
      } catch (cleanupFailure: unknown) {
        if (fixture.receiptDocuments.length > 0) {
          try {
            await clearE2EArtifacts(page, fixture);
          } catch (retryFailure: unknown) {
            throw new AggregateError(
              [cleanupFailure, retryFailure],
              'E2E artifact cleanup and exact receipt document cleanup retry both failed',
            );
          }
        }
        throw cleanupFailure;
      }
    } finally {
      fixtureContext = undefined;
    }
  });

  test.afterAll(async () => {
    await PRISMA.$disconnect();
  });

  test('submits an oldest-first prefix, keeps balances pending until approval, and releases a rejected follow-up payment', async ({
    browser,
    page,
  }) => {
    const residentTenantId = await login(page, TEST_USERS.residentB);
    const residentContext = await getMeContext(page, residentTenantId);
    const buildingId = residentContext.activeBuildingId;
    const unitId = residentContext.activeUnitId;

    await page.setViewportSize({ width: 390, height: 844 });

    expect(buildingId).toBeTruthy();
    expect(unitId).toBeTruthy();
    if (!buildingId || !unitId) {
      throw new Error('Expected resident B to have an active building and unit');
    }

    fixtureContext = {
      tenantId: residentTenantId,
      buildingId,
      unitId,
      chargeIds: [],
      proofFileIds: [],
      receiptDocuments: [],
    };

    const otherUnit = await PRISMA.unit.findFirst({
      where: {
        buildingId,
        id: { not: unitId },
      },
      select: { id: true },
    });
    expect(otherUnit).toBeTruthy();
    if (!otherUnit) {
      throw new Error('Expected a second unit in the same building for the rejection guard');
    }

    const foreignTenantCharge = await PRISMA.charge.findFirst({
      where: {
        tenantId: { not: residentTenantId },
        status: ChargeStatus.PENDING,
      },
      select: {
        id: true,
        tenantId: true,
        buildingId: true,
        unitId: true,
      },
    });
    expect(foreignTenantCharge).toBeTruthy();
    if (!foreignTenantCharge) {
      throw new Error('Expected a seed charge from another tenant');
    }

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminTenantId = await login(adminPage, TEST_USERS.tenantAdminB);
    expect(adminTenantId).toBe(residentTenantId);

    await clearE2EArtifacts(adminPage, fixtureContext);

    const juneCharge = await createCharge(
      adminPage,
      residentTenantId,
      buildingId,
      unitId,
      FIAT_PERIODS[0],
      pastDate(90),
      E2E_CHARGE_CONCEPTS[0],
      10000,
    );
    fixtureContext.chargeIds.push(juneCharge.id);
    const julyCharge = await createCharge(
      adminPage,
      residentTenantId,
      buildingId,
      unitId,
      FIAT_PERIODS[1],
      pastDate(60),
      E2E_CHARGE_CONCEPTS[1],
      10000,
    );
    fixtureContext.chargeIds.push(julyCharge.id);
    const augustCharge = await createCharge(
      adminPage,
      residentTenantId,
      buildingId,
      unitId,
      FIAT_PERIODS[2],
      futureDate(30),
      E2E_CHARGE_CONCEPTS[2],
      10000,
    );
    fixtureContext.chargeIds.push(augustCharge.id);
    const createdCharges = [juneCharge, julyCharge, augustCharge];

    expect(createdCharges.map((charge) => charge.period)).toEqual(['2026-06', '2026-07', '2026-08']);

    const otherUnitCharge = await createCharge(
      adminPage,
      residentTenantId,
      buildingId,
      otherUnit.id,
      '2026-09',
      futureDate(60),
      E2E_CHARGE_CONCEPTS[3],
      5000,
    );
    fixtureContext.chargeIds.push(otherUnitCharge.id);

    await page.goto(`/${residentTenantId}/resident/payments`);
    await expect(page).toHaveURL(new RegExp(`/${residentTenantId}/resident/payments$`));
    await expect(page.getByRole('spinbutton')).toHaveCount(0);
    await expect(page.getByText('Cargos próximos')).toBeVisible();

    const residentLedgerBefore = await getUnitLedger(page, residentTenantId, unitId);
    expect(arsAmount(residentLedgerBefore.totals.balanceByCurrency)).toBe(30000);
    const summaryBefore = await getBuildingSummary(adminPage, residentTenantId, buildingId);
    expect(arsAmount(summaryBefore.totalOutstandingByCurrency)).toBe(10000);
    expect(arsAmount(summaryBefore.totalPaidByCurrency)).toBe(0);
    expect(summaryBefore.delinquentUnitsCount).toBe(0); // 3F5: overdue-only (Aug charge due in the future)

    const firstPaymentProofFileId = await createPaymentProofDocument(
      page,
      residentTenantId,
      buildingId,
      unitId,
      E2E_PROOF_FILENAMES[0],
      'application/pdf',
      Buffer.from([1, 2, 3, 4]),
    );
    fixtureContext.proofFileIds.push(firstPaymentProofFileId);
    await submitPaymentViaApi(
      page,
      residentTenantId,
      buildingId,
      unitId,
      [createdCharges[0].id, createdCharges[1].id],
      20000,
      TEST_REFERENCE,
      firstPaymentProofFileId,
    );

    const submittedPayment = await fetchPaymentByReference(residentTenantId, buildingId, unitId, TEST_REFERENCE);
    expect(submittedPayment.status).toBe(PaymentStatus.SUBMITTED);
    expect(submittedPayment.amount).toBe(20000);
    expect(submittedPayment.paymentAllocations).toHaveLength(2);
    expect(submittedPayment.paymentAllocations.map((allocation) => allocation.charge.period)).toEqual([
      '2026-06',
      '2026-07',
    ]);
    expect(submittedPayment.paymentAllocations.map((allocation) => allocation.amount)).toEqual([10000, 10000]);

    const residentLedgerSubmitted = await getUnitLedger(page, residentTenantId, unitId);
    expect(arsAmount(residentLedgerSubmitted.totals.balanceByCurrency)).toBe(30000);
    expect(arsAmount(residentLedgerSubmitted.totals.totalPaidByCurrency)).toBe(0);
    expect(arsAmount(residentLedgerSubmitted.totals.totalAllocatedByCurrency)).toBe(0);

    const summarySubmitted = await getBuildingSummary(adminPage, residentTenantId, buildingId);
    expect(arsAmount(summarySubmitted.totalOutstandingByCurrency)).toBe(10000);
    expect(arsAmount(summarySubmitted.totalPaidByCurrency)).toBe(0);
    expect(summarySubmitted.delinquentUnitsCount).toBe(0); // 3F5: overdue-only

    await adminPage.goto(`/${residentTenantId}/finanzas?tab=payments`);
    await expect(adminPage.getByRole('heading', { name: /finanzas del conjunto/i })).toBeVisible();
    await expect(adminPage.getByText('Comprobante sin procesar')).toBeVisible();
    await approvePaymentViaApi(adminPage, residentTenantId, buildingId, submittedPayment.id);

    const approvedPayment = await fetchPaymentByReference(residentTenantId, buildingId, unitId, TEST_REFERENCE);
    expect(approvedPayment.status).toMatch(/APPROVED|RECONCILED/);
    const approvedPaymentReceipt = await waitForPaymentReceipt(
      residentTenantId,
      buildingId,
      unitId,
      approvedPayment.id,
      TEST_REFERENCE,
    );
    expect(approvedPaymentReceipt.paymentId).toBe(approvedPayment.id);
    expect(approvedPaymentReceipt.documentId).toBeTruthy();
    expect(approvedPaymentReceipt.fileId).toBeTruthy();
    expect(approvedPaymentReceipt.objectVersionId).toBeTruthy();
    await verifyReceiptStorageVersion(page, residentTenantId, approvedPaymentReceipt);
    expect(approvedPayment.paymentAllocations).toHaveLength(2);
    expect(approvedPayment.paymentAllocations.map((allocation) => allocation.charge.period)).toEqual([
      '2026-06',
      '2026-07',
    ]);

    const residentLedgerApproved = await getUnitLedger(page, residentTenantId, unitId);
    expect(arsAmount(residentLedgerApproved.totals.balanceByCurrency)).toBe(10000);
    expect(arsAmount(residentLedgerApproved.totals.totalPaidByCurrency)).toBe(20000);
    expect(arsAmount(residentLedgerApproved.totals.totalAllocatedByCurrency)).toBe(20000);

    const summaryApproved = await getBuildingSummary(adminPage, residentTenantId, buildingId);
    expect(arsAmount(summaryApproved.totalOutstandingByCurrency)).toBe(10000);
    expect(arsAmount(summaryApproved.totalPaidByCurrency)).toBe(0);
    expect(summaryApproved.delinquentUnitsCount).toBe(0); // 3F5: overdue-only

    const augustPaymentProofFileId = await createPaymentProofDocument(
      page,
      residentTenantId,
      buildingId,
      unitId,
      E2E_PROOF_FILENAMES[1],
      'application/pdf',
      Buffer.from([9, 8, 7, 6]),
    );
    fixtureContext.proofFileIds.push(augustPaymentProofFileId);
    await submitPaymentViaApi(
      page,
      residentTenantId,
      buildingId,
      unitId,
      [createdCharges[2].id],
      10000,
      AUGUST_PAYMENT_REFERENCE,
      augustPaymentProofFileId,
    );

    const augustPayment = await fetchPaymentByReference(
      residentTenantId,
      buildingId,
      unitId,
      AUGUST_PAYMENT_REFERENCE,
    );
    expect(augustPayment.status).toBe(PaymentStatus.SUBMITTED);
    expect(augustPayment.paymentAllocations).toHaveLength(1);
    expect(augustPayment.paymentAllocations[0]?.charge.period).toBe('2026-08');

    await adminPage.goto(`/${residentTenantId}/finanzas?tab=payments`);
    await rejectPaymentViaApi(adminPage, residentTenantId, buildingId, augustPayment.id, 'MONTO_INCORRECTO');

    const rejectedAugustPayment = await fetchPaymentByReference(
      residentTenantId,
      buildingId,
      unitId,
      AUGUST_PAYMENT_REFERENCE,
    );
    expect(rejectedAugustPayment.status).toBe(PaymentStatus.REJECTED);
    expect(rejectedAugustPayment.paymentAllocations).toHaveLength(0);

    const residentLedgerRejected = await getUnitLedger(page, residentTenantId, unitId);
    expect(arsAmount(residentLedgerRejected.totals.balanceByCurrency)).toBe(10000);
    expect(arsAmount(residentLedgerRejected.totals.totalPaidByCurrency)).toBe(20000);
    expect(arsAmount(residentLedgerRejected.totals.totalAllocatedByCurrency)).toBe(20000);

    const summaryRejected = await getBuildingSummary(adminPage, residentTenantId, buildingId);
    expect(arsAmount(summaryRejected.totalOutstandingByCurrency)).toBe(10000);
    expect(arsAmount(summaryRejected.totalPaidByCurrency)).toBe(0);
    expect(summaryRejected.delinquentUnitsCount).toBe(0); // 3F5: overdue-only

    const delinquencyCount = await getTenantDelinquencyCount(adminPage, residentTenantId, buildingId);
    expect(delinquencyCount).toBe(1);

    const otherUnitLedgerResponse = await page.request.get(`${API_ORIGIN}/units/${otherUnit.id}/ledger?periodFrom=2026-06&periodTo=2026-08`, {
      headers: {
        'X-Tenant-Id': residentTenantId,
        Accept: 'application/json',
      },
    });
    expect(otherUnitLedgerResponse.status()).toBeGreaterThanOrEqual(400);

    const foreignTenantLedgerResponse = await page.request.get(`${API_ORIGIN}/units/${foreignTenantCharge.unitId}/ledger?periodFrom=2026-06&periodTo=2026-08`, {
      headers: {
        'X-Tenant-Id': residentTenantId,
        Accept: 'application/json',
      },
    });
    expect(foreignTenantLedgerResponse.status()).toBeGreaterThanOrEqual(400);

      });

      test.describe('receipt teardown safeguards', () => {
        const clearE2EPaymentArtifacts = teardownPaymentReceipts;
        const ReceiptCleanupFailedError = ReceiptTeardownFailedError;
        const ReceiptCleanupTimeoutError = ReceiptTeardownTimeoutError;
        const throwCleanupFailures = throwReceiptTeardownFailures;

        function payment(overrides: Partial<PaymentArtifact> = {}): PaymentArtifact {
          return {
            id: 'payment-1',
            reference: TEST_REFERENCE,
            proofFileId: 'proof-1',
            status: PaymentStatus.APPROVED,
            receiptStatus: ReceiptStatus.READY,
            receiptDocumentId: 'document-1',
            ...overrides,
          };
        }

        function receipt(overrides: Partial<ReceiptDocumentArtifact> = {}): ReceiptDocumentArtifact {
          return {
            paymentId: 'payment-1',
            documentId: 'document-1',
            fileId: 'file-1',
            bucket: 'e2e-payments',
            objectKey: 'e2e/payments/receipt-1.pdf',
            objectVersionId: 'version-1',
            ...overrides,
          };
        }

        function fixture(receiptDocuments: ReceiptDocumentArtifact[] = []): E2EArtifactContext {
          return {
            tenantId: 'tenant-1',
            buildingId: 'building-1',
            unitId: 'unit-1',
            chargeIds: [],
            proofFileIds: [],
            receiptDocuments,
          };
        }

        test('cleans FAILED payments and reports the receipt failure only after cleanup', async () => {
          const calls: string[] = [];
          const failedPayment = payment({
            id: 'payment-failed',
            receiptStatus: ReceiptStatus.FAILED,
            receiptDocumentId: null,
          });
          const result = await clearE2EPaymentArtifacts(fixture(), [failedPayment], {
            waitForReceipt: async () => {
              throw new Error('waitForReceipt must not run for FAILED receipts');
            },
            unlinkReceiptDocument: async () => { calls.push('unlink'); },
            restoreReceiptDocument: async () => { calls.push('restore'); },
            writeReceiptCleanupManifest: async () => { calls.push('manifest'); },
            deleteReceiptDocument: async () => { calls.push('delete-document'); },
            deletePaymentAllocations: async (paymentIds) => { calls.push(`allocations:${paymentIds.join(',')}`); },
            deletePayments: async (paymentIds) => { calls.push(`payments:${paymentIds.join(',')}`); },
          });

          expect(calls).toEqual(['allocations:payment-failed', 'payments:payment-failed']);
          expect(result.hasPreservedPayments).toBe(false);
          expect(() => throwCleanupFailures(result.failures)).toThrow(ReceiptCleanupFailedError);
        });

        test('detaches a READY receipt, deletes its document, then deletes only its payment artifacts', async () => {
          const calls: string[] = [];
          const readyReceipt = receipt();
          const unrelatedReceipt = receipt({ paymentId: 'payment-unrelated', documentId: 'document-unrelated' });
          const result = await clearE2EPaymentArtifacts(fixture([readyReceipt, unrelatedReceipt]), [payment()], {
            waitForReceipt: async () => readyReceipt,
            unlinkReceiptDocument: async (candidate) => { calls.push(`unlink:${candidate.documentId}`); },
            restoreReceiptDocument: async (candidate) => { calls.push(`restore:${candidate.documentId}`); },
            writeReceiptCleanupManifest: async (candidate) => { calls.push(`manifest:${candidate.documentId}`); },
            deleteReceiptDocument: async (candidate) => { calls.push(`delete-document:${candidate.documentId}`); },
            deletePaymentAllocations: async (paymentIds) => { calls.push(`allocations:${paymentIds.join(',')}`); },
            deletePayments: async (paymentIds) => { calls.push(`payments:${paymentIds.join(',')}`); },
          });

          expect(calls).toEqual([
            'unlink:document-1',
            'manifest:document-1',
            'delete-document:document-1',
            'allocations:payment-1',
            'payments:payment-1',
          ]);
          expect(result.hasPreservedPayments).toBe(false);
          expect(result.failures).toEqual([]);
          expect(unrelatedReceipt).toEqual(receipt({ paymentId: 'payment-unrelated', documentId: 'document-unrelated' }));
        });

        test('restores the READY payment relation and allocation when receipt document deletion fails', async () => {
          const calls: string[] = [];
          const readyReceipt = receipt();
          const deleteFailure = new Error('document delete failed');
          const result = await clearE2EPaymentArtifacts(fixture([readyReceipt]), [payment()], {
            waitForReceipt: async () => readyReceipt,
            unlinkReceiptDocument: async () => { calls.push('unlink'); },
            restoreReceiptDocument: async () => { calls.push('restore'); },
            writeReceiptCleanupManifest: async () => { calls.push('manifest'); },
            deleteReceiptDocument: async () => {
              calls.push('delete-document');
              throw deleteFailure;
            },
            deletePaymentAllocations: async () => { calls.push('allocations'); },
            deletePayments: async () => { calls.push('payments'); },
          });

          expect(calls).toEqual(['unlink', 'manifest', 'delete-document', 'restore']);
          expect(result.hasPreservedPayments).toBe(true);
          expect(result.failures).toEqual([deleteFailure]);
          expect(readyReceipt.paymentId).toBe('payment-1');
        });

        test('preserves the document deletion and relation restoration errors when restoration fails', async () => {
          const documentDeleteFailure = new Error('document delete failed');
          const restoreFailure = new Error('relation restore failed');
          const result = await clearE2EPaymentArtifacts(fixture([receipt()]), [payment()], {
            waitForReceipt: async () => receipt(),
            unlinkReceiptDocument: async () => undefined,
            restoreReceiptDocument: async () => {
              throw restoreFailure;
            },
            writeReceiptCleanupManifest: async () => undefined,
            deleteReceiptDocument: async () => {
              throw documentDeleteFailure;
            },
            deletePaymentAllocations: async () => {
              throw new Error('payment allocations must remain after document deletion failure');
            },
            deletePayments: async () => {
              throw new Error('payment must remain after document deletion failure');
            },
          });

          expect(result.hasPreservedPayments).toBe(true);
          expect(result.failures).toHaveLength(1);
          expect(result.failures[0]).toBeInstanceOf(AggregateError);
          expect((result.failures[0] as AggregateError).errors).toEqual([documentDeleteFailure, restoreFailure]);
        });

        test('safely deletes a FAILED payment with no receipt document', async () => {
          const calls: string[] = [];
          const result = await clearE2EPaymentArtifacts(
            fixture(),
            [payment({ receiptStatus: ReceiptStatus.FAILED, receiptDocumentId: null })],
            {
              waitForReceipt: async () => {
                throw new Error('waitForReceipt must not run for FAILED receipts');
              },
              unlinkReceiptDocument: async () => { calls.push('unlink'); },
              restoreReceiptDocument: async () => { calls.push('restore'); },
              writeReceiptCleanupManifest: async () => { calls.push('manifest'); },
              deleteReceiptDocument: async () => { calls.push('delete-document'); },
              deletePaymentAllocations: async () => { calls.push('allocations'); },
              deletePayments: async () => { calls.push('payments'); },
            },
          );

          expect(calls).toEqual(['allocations', 'payments']);
          expect(result.hasPreservedPayments).toBe(false);
          expect(result.failures[0]).toBeInstanceOf(ReceiptCleanupFailedError);
        });

        test('preserves a payment and its allocation when receipt readiness times out', async () => {
              await test.step('keeps the payment allocation untouched', async () => {
          const calls: string[] = [];
          const pendingPayment = payment({
            receiptStatus: ReceiptStatus.PENDING,
            receiptDocumentId: null,
          });
          const result = await clearE2EPaymentArtifacts(fixture(), [pendingPayment], {
            waitForReceipt: async (candidate) => {
              throw new ReceiptCleanupTimeoutError(candidate.id);
            },
            unlinkReceiptDocument: async () => { calls.push('unlink'); },
            restoreReceiptDocument: async () => { calls.push('restore'); },
            writeReceiptCleanupManifest: async () => { calls.push('manifest'); },
            deleteReceiptDocument: async () => { calls.push('delete-document'); },
            deletePaymentAllocations: async () => { calls.push('allocations'); },
            deletePayments: async () => { calls.push('payments'); },
          });

          expect(calls).toEqual([]);
          expect(result.hasPreservedPayments).toBe(true);
          expect(result.failures[0]).toBeInstanceOf(ReceiptCleanupTimeoutError);
        });
      });
  });
});
