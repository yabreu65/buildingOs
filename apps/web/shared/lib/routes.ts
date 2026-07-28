/**
 * Route Builder Helper
 *
 * Centralized route generation for tenant/building/unit navigation.
 * Single point of change: if URLs change, update here only.
 *
 * Usage:
 *   router.push(routes.buildingsList(tenantId))
 *   href={routes.unitDashboard(tenantId, buildingId, unitId)}
 */

/**
 * Dashboard route for tenant
 */
export function tenantDashboard(tenantId: string): string {
  return `/${tenantId}/dashboard`;
}

/**
 * Buildings list for tenant
 */
export function buildingsList(tenantId: string): string {
  return `/${tenantId}/buildings`;
}

/**
 * Building overview (hub with KPIs)
 */
export function buildingOverview(tenantId: string, buildingId: string): string {
  return `/${tenantId}/buildings/${buildingId}`;
}

/**
 * Units list for building
 */
export function buildingUnits(tenantId: string, buildingId: string): string {
  return `/${tenantId}/buildings/${buildingId}/units`;
}

/**
 * Unit detail dashboard
 */
export function unitDashboard(
  tenantId: string,
  buildingId: string,
  unitId: string
): string {
  return `/${tenantId}/buildings/${buildingId}/units/${unitId}`;
}

/**
 * Building residents page (placeholder)
 */
export function buildingResidents(tenantId: string, buildingId: string): string {
  return `/${tenantId}/buildings/${buildingId}/residents`;
}

/**
 * Building tickets page (placeholder)
 */
export function buildingTickets(tenantId: string, buildingId: string): string {
  return `/${tenantId}/buildings/${buildingId}/tickets`;
}

/**
 * Canonical ticket detail route shared by all entrances.
 */
export function ticketDetailPath(tenantId: string, ticketId: string): string {
  return `/${encodeURIComponent(tenantId)}/tickets/${encodeURIComponent(ticketId)}`;
}

/**
 * Resident ticket detail route preserving portal context.
 */
export function residentTicketDetailPath(tenantId: string, ticketId: string): string {
  return `${ticketDetailPath(tenantId, ticketId)}?portal=resident`;
}

/**
 * Resident tickets list.
 */
export function residentTicketsPath(tenantId: string): string {
  return `/${encodeURIComponent(tenantId)}/resident/tickets`;
}

/**
 * Building payments page
 */
export function buildingPayments(tenantId: string, buildingId: string): string {
  return `/${tenantId}/buildings/${buildingId}/payments`;
}

/**
 * Building settings page
 */
export function buildingSettings(tenantId: string, buildingId: string): string {
  return `/${tenantId}/buildings/${buildingId}/settings`;
}

/**
 * Tenant-level reports page
 */
export function tenantReports(tenantId: string): string {
  return `/${tenantId}/reports`;
}

/**
 * Tenant-level onboarding import wizard
 */
export function onboardingImport(tenantId: string): string {
  return `/${tenantId}/settings/onboarding-import`;
}

/**
 * Tenant-level categories (Rubros) page
 */
export function tenantCategories(tenantId: string): string {
  return `/${tenantId}/finance/categories`;
}

/**
 * Building-level categories shortcut
 */
export function buildingCategories(tenantId: string, buildingId: string): string {
  return `/${tenantId}/buildings/${buildingId}/finance/categories`;
}

/**
 * Building-level reports page
 */
export function buildingReports(tenantId: string, buildingId: string): string {
  return `/${tenantId}/buildings/${buildingId}/reports`;
}

/**
 * Super admin dashboard
 */
export function superAdminDashboard(): string {
  return '/super-admin';
}

/**
 * All available route builders
 */
export const routes = {
  tenantDashboard,
  buildingsList,
  buildingOverview,
  buildingUnits,
  unitDashboard,
  buildingResidents,
  buildingTickets,
  buildingPayments,
  buildingSettings,
  tenantReports,
  onboardingImport,
  buildingReports,
  superAdminDashboard,
  tenantCategories,
  buildingCategories,
  ticketDetailPath,
  residentTicketDetailPath,
};

export default routes;
