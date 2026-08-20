import { type Page, expect } from '@playwright/test';
import { login as baseLogin, TEST_USERS } from './auth';

/**
 * Finance tab identifiers as used in the URL query parameter `?tab=`.
 * These match the `Tab` type in TenantFinanceDashboard.tsx.
 */
export const FINANCE_TABS = {
  overview: 'overview',
  expenses: 'expenses',
  rubros: 'rubros',
  recurring: 'recurring',
  payments: 'payments',
  charges: 'charges',
  incomes: 'incomes',
  funds: 'funds',
  policies: 'policies',
  delinquent: 'delinquent',
  reports: 'reports',
  notas: 'notas',
  settings: 'settings',
} as const;

export type FinanceTab = keyof typeof FINANCE_TABS;

/**
 * Finance route builder — matches `ROUTES.finance()` in navigation.ts
 */
export function financeRoute(tenantId: string): string {
  return `/${tenantId}/finanzas`;
}

/**
 * Finance tab route with query parameter.
 *
 * @example
 * ```ts
 * await page.goto(financeTabRoute(tenantId, 'payments'));
 * // -> /${tenantId}/finanzas?tab=payments
 * ```
 */
export function financeTabRoute(tenantId: string, tab: FinanceTab): string {
  const base = financeRoute(tenantId);
  return tab === 'overview' ? base : `${base}?tab=${FINANCE_TABS[tab]}`;
}

/**
 * Login as a finance admin user and return the tenantId.
 * Convenience wrapper around `login()` with the default admin user.
 */
export async function loginAsFinanceAdmin(page: Page): Promise<string> {
  return baseLogin(page, TEST_USERS.tenantAdminA);
}

/**
 * Login as a finance resident user and return the tenantId.
 */
export async function loginAsFinanceResident(page: Page): Promise<string> {
  return baseLogin(page, TEST_USERS.resident);
}

/**
 * Navigate to a finance tab and wait for the page to be interactive.
 *
 * @param page - Playwright page
 * @param tenantId - Tenant ID from login
 * @param tab - Finance tab to navigate to
 */
export async function navigateToFinanceTab(
  page: Page,
  tenantId: string,
  tab: FinanceTab,
): Promise<void> {
  await page.goto(financeTabRoute(tenantId, tab));
}

/**
 * Assert the finance page heading is visible.
 * Uses the Spanish heading "Finanzas del conjunto" from TenantFinanceDashboard.
 */
export async function expectFinancePageHeading(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: /finanzas del conjunto/i }),
  ).toBeVisible();
}

/**
 * Assert a specific finance tab button is active (selected).
 */
export async function expectActiveTab(page: Page, tab: FinanceTab): Promise<void> {
  const label = getTabLabel(tab);
  const button = page.getByRole('button', { name: new RegExp(label, 'i') });
  await expect(button).toHaveClass(/bg-primary/);
}

/**
 * Click a finance tab button by its label.
 */
export async function clickFinanceTab(page: Page, tab: FinanceTab): Promise<void> {
  const label = getTabLabel(tab);
  await page.getByRole('button', { name: new RegExp(label, 'i') }).click();
}

/**
 * Get the visible label for a finance tab (matches TenantFinanceDashboard.tsx).
 */
function getTabLabel(tab: FinanceTab): string {
  const labels: Record<FinanceTab, string> = {
    overview: 'Resumen',
    expenses: 'Gastos comunes',
    rubros: 'Rubros',
    recurring: 'Reglas recurrentes',
    payments: 'Pagos',
    charges: 'Cargos',
    incomes: 'Ingresos',
    funds: 'Fondos',
    policies: 'Políticas de ingreso',
    delinquent: 'Morosos',
    reports: 'Historial de gastos',
    notas: 'Notas Revelatorias',
    settings: 'Configuración',
  };
  return labels[tab];
}
