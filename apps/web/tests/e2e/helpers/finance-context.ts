import { type Page, expect } from '@playwright/test';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000';
const FINANCE_FIXTURE_BUILDING_NAME = 'Torre A Test';
const FINANCE_FIXTURE_UNIT_CODE = 'A1-101';
const NORMAL_V3_PERIOD = '2026-06';
const NORMAL_V3_EXPENSE_DESCRIPTION = '[FIN07D:NORMAL_V3] Expense A1 6000';

/**
 * Resolved deterministic IDs from the seed fixture.
 * All fields are non-null after successful resolution.
 */
export interface FinanceTestContext {
  readonly tenantId: string;
  readonly buildingId: string;
  readonly unitId: string;
  readonly unitCode: string;
}

interface MeContextResponse {
  activeBuildingId: string | null;
  activeUnitId: string | null;
}

interface BuildingSummaryResponse {
  id: string;
  name: string;
}

interface UnitSummaryResponse {
  id: string;
  code: string;
}

interface ExpenseSummaryResponse {
  description: string;
}

/**
 * Resolve the finance E2E context for an admin user.
 *
 * Strategy:
 * 1. Login as tenantAdminA (done before calling this)
 * 2. GET /tenants/:tenantId/buildings to get Torre A Test
 * 3. GET /tenants/:tenantId/buildings/:buildingId/units to get A1-101
 *
 * The seeded names and codes are logical fixture identities. The tenant-scoped
 * endpoints remain authorization-bound through the authenticated session.
 */
export async function resolveFinanceAdminContext(
  page: Page,
  tenantId: string,
): Promise<FinanceTestContext> {
  const buildingsResponse = await page.request.get(`${API_ORIGIN}/tenants/${tenantId}/buildings`, {
    headers: {
      'X-Tenant-Id': tenantId,
      'x-portal-context': 'admin',
      Accept: 'application/json',
    },
  });

  expect(buildingsResponse.ok()).toBe(true);
  const buildings = (await buildingsResponse.json()) as BuildingSummaryResponse[];
  expect(buildings.length).toBeGreaterThanOrEqual(1);

  const building = buildings.find((candidate) => candidate.name === FINANCE_FIXTURE_BUILDING_NAME);
  expect(building).toBeTruthy();
  if (!building) {
    throw new Error(`Missing seeded building: ${FINANCE_FIXTURE_BUILDING_NAME}`);
  }

  const unitsResponse = await page.request.get(
    `${API_ORIGIN}/tenants/${tenantId}/buildings/${building.id}/units`,
    {
    headers: {
      'X-Tenant-Id': tenantId,
      'x-portal-context': 'admin',
      Accept: 'application/json',
    },
    },
  );

  expect(unitsResponse.ok()).toBe(true);
  const units = (await unitsResponse.json()) as UnitSummaryResponse[];
  expect(units.length).toBeGreaterThanOrEqual(1);

  const unit = units.find((candidate) => candidate.code === FINANCE_FIXTURE_UNIT_CODE);
  expect(unit).toBeTruthy();
  if (!unit) {
    throw new Error(`Missing seeded unit: ${FINANCE_FIXTURE_UNIT_CODE}`);
  }

  return {
    tenantId,
    buildingId: building.id,
    unitId: unit.id,
    unitCode: unit.code,
  };
}

/**
 * Resolve the finance E2E context for a resident user.
 *
 * Strategy:
 * 1. Login as resident (done before calling this)
 * 2. GET /me/context to get activeBuildingId and activeUnitId
 *
 * The seed assigns residents to specific units deterministically.
 */
export async function resolveFinanceResidentContext(
  page: Page,
  tenantId: string,
): Promise<FinanceTestContext> {
  const response = await page.request.get(`${API_ORIGIN}/me/context`, {
    headers: {
      'X-Tenant-Id': tenantId,
      Accept: 'application/json',
    },
  });

  expect(response.ok()).toBe(true);
  const context = (await response.json()) as MeContextResponse;

  expect(context.activeBuildingId).toBeTruthy();
  expect(context.activeUnitId).toBeTruthy();

  if (!context.activeBuildingId || !context.activeUnitId) {
    throw new Error(
      `Resident context missing buildingId or unitId: ${JSON.stringify(context)}`,
    );
  }

  return {
    tenantId,
    buildingId: context.activeBuildingId,
    unitId: context.activeUnitId,
    unitCode: 'A1-102', // Seed assigns test-resident to unit A1-102
  };
}

/**
 * Prove that the authenticated admin can read the seeded NORMAL_V3 fixture
 * through the tenant-scoped finance API.
 */
export async function assertNormalV3FixtureReadable(
  page: Page,
  context: FinanceTestContext,
): Promise<void> {
  const response = await page.request.get(
    `${API_ORIGIN}/tenants/${context.tenantId}/finance/expenses?buildingId=${context.buildingId}&period=${NORMAL_V3_PERIOD}`,
    {
      headers: {
        'X-Tenant-Id': context.tenantId,
        'x-portal-context': 'admin',
        Accept: 'application/json',
      },
    },
  );

  expect(response.ok()).toBe(true);
  const expenses = (await response.json()) as ExpenseSummaryResponse[];
  expect(
    expenses.some((expense) => expense.description === NORMAL_V3_EXPENSE_DESCRIPTION),
  ).toBe(true);
}
