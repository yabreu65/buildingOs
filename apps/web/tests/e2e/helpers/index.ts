/**
 * Finance E2E test helpers — barrel export.
 *
 * Import from this module to get all finance E2E utilities:
 * ```ts
 * import { loginAsFinanceAdmin, navigateToFinanceTab, attachBrowserObservability } from '../helpers';
 * ```
 */

// Context resolution
export {
  type FinanceTestContext,
  resolveFinanceAdminContext,
  resolveFinanceResidentContext,
  assertNormalV3FixtureReadable,
} from './finance-context';

// Browser observability
export {
  type BrowserObservability,
  attachBrowserObservability,
} from './observability';

// HTTP assertions
export {
  EXPECTED_FAILURE_STATUSES,
  type ExpectedFailureStatus,
  expectHTTPFailure,
  expectHTTPSuccess,
} from './http-assertions';

// Finance navigation
export {
  FINANCE_TABS,
  type FinanceTab,
  financeRoute,
  financeTabRoute,
  loginAsFinanceAdmin,
  loginAsFinanceResident,
  navigateToFinanceTab,
  expectFinancePageHeading,
  expectActiveTab,
  clickFinanceTab,
} from './finance-navigation';

// Responsive helpers
export {
  VIEWPORTS,
  type ViewportName,
  setViewport,
  expectNoHorizontalOverflow,
  expectVisibleInViewport,
} from './responsive';

export { acquireFin07dMutationLock } from './finance-mutation-lock';

// Re-export existing helpers for convenience
export { login, logout, TEST_USERS, type TestUser } from './auth';
export { ROUTES, navigateTo, clickNavLink } from './navigation';
