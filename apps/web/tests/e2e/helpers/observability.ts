import { type Page } from '@playwright/test';

/**
 * Collected browser observability signals for a single test.
 * All arrays are append-only; consumers inspect them at test teardown.
 */
export interface BrowserObservability {
  /** Unhandled page errors (page.on('pageerror')) */
  readonly pageErrors: string[];
  /** Console error messages (console.error) */
  readonly consoleErrors: string[];
  /** Console warnings, collected for diagnosis but not failed by default. */
  readonly consoleWarnings: string[];
  /** HTTP responses with status >= 500 */
  readonly http5xx: Array<{ url: string; status: number; statusText: string }>;
  /** Post-login HTTP responses with status 401. */
  readonly http401: Array<{ url: string; statusText: string }>;
  /** Remove all event listeners. Must be called in test cleanup. */
  detach(): void;
}

/**
 * Attach browser observability monitors to a page.
 *
 * Returns a `BrowserObservability` instance that collects:
 * - pageerror events (uncaught JS exceptions)
 * - console.error messages
 * - console warnings for diagnostic reporting
 * - HTTP responses with status >= 500
 * - post-login HTTP 401 responses
 *
 * The caller MUST call `detach()` in test cleanup (test.afterEach or
 * test.afterAll) to remove listeners and avoid leaks.
 *
 * @example
 * ```ts
 * const obs = attachBrowserObservability(page);
 * test.afterAll(() => obs.detach());
 * // ... run test ...
 * expect(obs.pageErrors).toHaveLength(0);
 * ```
 */
export function attachBrowserObservability(page: Page): BrowserObservability {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const http5xx: Array<{ url: string; status: number; statusText: string }> = [];
  const http401: Array<{ url: string; statusText: string }> = [];

  const onPageError = (error: Error) => {
    pageErrors.push(error.message);
  };

  const onConsole = (msg: { type(): string; text(): string }) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
    } else if (msg.type() === 'warning') {
      consoleWarnings.push(`[${msg.type()}] ${msg.text()}`);
    }
  };

  const onResponse = (response: { url(): string; status(): number; statusText(): string }) => {
    const status = response.status();
    if (status >= 500) {
      http5xx.push({
        url: response.url(),
        status,
        statusText: response.statusText(),
      });
    }
    if (status === 401) {
      http401.push({
        url: response.url(),
        statusText: response.statusText(),
      });
    }
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('response', onResponse);

  let detached = false;

  return {
    pageErrors,
    consoleErrors,
    consoleWarnings,
    http5xx,
    http401,
    detach() {
      if (detached) return;
      detached = true;
      page.removeListener('pageerror', onPageError);
      page.removeListener('console', onConsole);
      page.removeListener('response', onResponse);
    },
  } satisfies BrowserObservability;
}
