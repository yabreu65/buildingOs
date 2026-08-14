import { expect, test, type Page } from '@playwright/test';
import { PrismaClient, ChargeType, ChargeStatus, PaymentStatus } from '@prisma/client';

import { login, TEST_USERS } from '../helpers/auth';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000';
const PRISMA = new PrismaClient();
const TEST_REFERENCE = 'E2E-FIN-01';
const FIAT_PERIODS = ['2026-06', '2026-07', '2026-08'] as const;

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
    totalCharges: number;
    totalPaid: number;
    totalAllocated: number;
    balance: number;
    currency: string;
  };
}

interface FinancialSummaryResponse {
  totalChargesByCurrency: Array<{ currency: string; amountMinor: number }>;
  totalPaidByCurrency: Array<{ currency: string; amountMinor: number }>;
  totalOutstandingByCurrency: Array<{ currency: string; amountMinor: number }>;
  delinquentUnitsCount: number;
}

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

async function clearE2EArtifacts(tenantId: string, buildingId: string, unitId: string): Promise<void> {
  const payments = await PRISMA.payment.findMany({
    where: {
      tenantId,
      reference: { startsWith: TEST_REFERENCE },
    },
    select: { id: true },
  });

  if (payments.length > 0) {
    const paymentIds = payments.map((payment) => payment.id);
    await PRISMA.paymentAllocation.deleteMany({
      where: { paymentId: { in: paymentIds } },
    });
    await PRISMA.payment.deleteMany({
      where: { id: { in: paymentIds } },
    });
  }

  const charges = await PRISMA.charge.findMany({
    where: {
      tenantId,
      buildingId,
      unitId,
      period: { in: [...FIAT_PERIODS] },
    },
    select: { id: true },
  });

  if (charges.length > 0) {
    const chargeIds = charges.map((charge) => charge.id);
    await PRISMA.paymentAllocation.deleteMany({
      where: { chargeId: { in: chargeIds } },
    });
    await PRISMA.charge.deleteMany({
      where: { id: { in: chargeIds } },
    });
  }

  const taggedCharges = await PRISMA.charge.findMany({
    where: {
      tenantId,
      buildingId,
      concept: { startsWith: TEST_REFERENCE },
    },
    select: { id: true },
  });

  if (taggedCharges.length > 0) {
    const taggedChargeIds = taggedCharges.map((charge) => charge.id);
    await PRISMA.paymentAllocation.deleteMany({
      where: { chargeId: { in: taggedChargeIds } },
    });
    await PRISMA.charge.deleteMany({
      where: { id: { in: taggedChargeIds } },
    });
  }

  const taggedFiles = await PRISMA.file.findMany({
    where: {
      tenantId,
      objectKey: { startsWith: `e2e/payments/${TEST_REFERENCE}` },
    },
    select: { id: true },
  });

  if (taggedFiles.length > 0) {
    await PRISMA.file.deleteMany({
      where: {
        id: { in: taggedFiles.map((file) => file.id) },
      },
    });
  }
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

async function fetchPaymentByReference(reference: string): Promise<{
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
    where: { reference },
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

    await clearE2EArtifacts(residentTenantId, buildingId, unitId);

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

    const createdCharges = await Promise.all([
      createCharge(adminPage, residentTenantId, buildingId, unitId, '2026-06', '2026-06-15', 'Expensas Junio 2026', 10000),
      createCharge(adminPage, residentTenantId, buildingId, unitId, '2026-07', '2026-07-15', 'Expensas Julio 2026', 10000),
      createCharge(adminPage, residentTenantId, buildingId, unitId, '2026-08', '2026-08-15', 'Expensas Agosto 2026', 10000),
    ]);

    expect(createdCharges.map((charge) => charge.period)).toEqual(['2026-06', '2026-07', '2026-08']);

    await createCharge(
      adminPage,
      residentTenantId,
      buildingId,
      otherUnit.id,
      '2026-09',
      '2026-09-20',
      `${TEST_REFERENCE} - Expensas Unidad Vecina`,
      5000,
    );

    await page.goto(`/${residentTenantId}/resident/payments`);
    await expect(page).toHaveURL(new RegExp(`/${residentTenantId}/resident/payments$`));
    await expect(page.getByRole('spinbutton')).toHaveCount(0);
    await expect(page.getByText('Cargos próximos')).toBeVisible();

    const residentLedgerBefore = await getUnitLedger(page, residentTenantId, unitId);
    expect(residentLedgerBefore.totals.balance).toBe(30000);
    const summaryBefore = await getBuildingSummary(adminPage, residentTenantId, buildingId);
    expect(arsAmount(summaryBefore.totalOutstandingByCurrency)).toBe(10000);
    expect(arsAmount(summaryBefore.totalPaidByCurrency)).toBe(0);
    expect(summaryBefore.delinquentUnitsCount).toBe(1);

    const firstPaymentProofFileId = await createPaymentProofDocument(
      page,
      residentTenantId,
      buildingId,
      unitId,
      'proof.pdf',
      'application/pdf',
      Buffer.from([1, 2, 3, 4]),
    );
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

    const submittedPayment = await fetchPaymentByReference(TEST_REFERENCE);
    expect(submittedPayment.status).toBe(PaymentStatus.SUBMITTED);
    expect(submittedPayment.amount).toBe(20000);
    expect(submittedPayment.paymentAllocations).toHaveLength(2);
    expect(submittedPayment.paymentAllocations.map((allocation) => allocation.charge.period)).toEqual([
      '2026-06',
      '2026-07',
    ]);
    expect(submittedPayment.paymentAllocations.map((allocation) => allocation.amount)).toEqual([10000, 10000]);

    const residentLedgerSubmitted = await getUnitLedger(page, residentTenantId, unitId);
    expect(residentLedgerSubmitted.totals.balance).toBe(30000);
    expect(residentLedgerSubmitted.totals.totalPaid).toBe(0);
    expect(residentLedgerSubmitted.totals.totalAllocated).toBe(0);

    const summarySubmitted = await getBuildingSummary(adminPage, residentTenantId, buildingId);
    expect(arsAmount(summarySubmitted.totalOutstandingByCurrency)).toBe(10000);
    expect(arsAmount(summarySubmitted.totalPaidByCurrency)).toBe(0);
    expect(summarySubmitted.delinquentUnitsCount).toBe(1);

    await adminPage.goto(`/${residentTenantId}/finanzas?tab=payments`);
    await expect(adminPage.getByRole('heading', { name: /finanzas del conjunto/i })).toBeVisible();
    await expect(adminPage.getByText('Comprobante sin procesar')).toBeVisible();
    await approvePaymentViaApi(adminPage, residentTenantId, buildingId, submittedPayment.id);

    const approvedPayment = await fetchPaymentByReference(TEST_REFERENCE);
    expect(approvedPayment.status).toMatch(/APPROVED|RECONCILED/);
    expect(approvedPayment.paymentAllocations).toHaveLength(2);
    expect(approvedPayment.paymentAllocations.map((allocation) => allocation.charge.period)).toEqual([
      '2026-06',
      '2026-07',
    ]);

    const residentLedgerApproved = await getUnitLedger(page, residentTenantId, unitId);
    expect(residentLedgerApproved.totals.balance).toBe(10000);
    expect(residentLedgerApproved.totals.totalPaid).toBe(20000);
    expect(residentLedgerApproved.totals.totalAllocated).toBe(20000);

    const summaryApproved = await getBuildingSummary(adminPage, residentTenantId, buildingId);
    expect(arsAmount(summaryApproved.totalOutstandingByCurrency)).toBe(10000);
    expect(arsAmount(summaryApproved.totalPaidByCurrency)).toBe(0);
    expect(summaryApproved.delinquentUnitsCount).toBe(1);

    const augustPaymentProofFileId = await createPaymentProofDocument(
      page,
      residentTenantId,
      buildingId,
      unitId,
      'proof-august.pdf',
      'application/pdf',
      Buffer.from([9, 8, 7, 6]),
    );
    await submitPaymentViaApi(
      page,
      residentTenantId,
      buildingId,
      unitId,
      [createdCharges[2].id],
      10000,
      `${TEST_REFERENCE}-AUG`,
      augustPaymentProofFileId,
    );

    const augustPayment = await fetchPaymentByReference(`${TEST_REFERENCE}-AUG`);
    expect(augustPayment.status).toBe(PaymentStatus.SUBMITTED);
    expect(augustPayment.paymentAllocations).toHaveLength(1);
    expect(augustPayment.paymentAllocations[0]?.charge.period).toBe('2026-08');

    await adminPage.goto(`/${residentTenantId}/finanzas?tab=payments`);
    await rejectPaymentViaApi(adminPage, residentTenantId, buildingId, augustPayment.id, 'MONTO_INCORRECTO');

    const rejectedAugustPayment = await fetchPaymentByReference(`${TEST_REFERENCE}-AUG`);
    expect(rejectedAugustPayment.status).toBe(PaymentStatus.REJECTED);
    expect(rejectedAugustPayment.paymentAllocations).toHaveLength(0);

    const residentLedgerRejected = await getUnitLedger(page, residentTenantId, unitId);
    expect(residentLedgerRejected.totals.balance).toBe(10000);
    expect(residentLedgerRejected.totals.totalPaid).toBe(20000);
    expect(residentLedgerRejected.totals.totalAllocated).toBe(20000);

    const summaryRejected = await getBuildingSummary(adminPage, residentTenantId, buildingId);
    expect(arsAmount(summaryRejected.totalOutstandingByCurrency)).toBe(10000);
    expect(arsAmount(summaryRejected.totalPaidByCurrency)).toBe(0);
    expect(summaryRejected.delinquentUnitsCount).toBe(1);

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
});
