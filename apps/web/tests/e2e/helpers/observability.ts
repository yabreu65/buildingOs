import { type Page, type Response } from '@playwright/test';

interface ObservabilityTestContext {
  readonly testTitle?: string;
  readonly workerIndex?: number;
  readonly parallelIndex?: number;
}

interface Http5xxObservation {
  readonly timestamp: string;
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  body: string | null;
  readonly testTitle?: string;
  readonly workerIndex?: number;
  readonly parallelIndex?: number;
}

interface TargetBuildingsObservation {
  readonly timestamp: string;
  readonly requestStartedAt: number;
  readonly method: string;
  readonly url: string;
  readonly testTitle?: string;
  readonly workerIndex?: number;
  readonly parallelIndex?: number;
  responseStatus?: number;
  responseStatusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  requestFailureErrorText?: string;
  responseAt?: number;
  requestFailedAt?: number;
  benignClassification?: 'BENIGN_DUPLICATE_ABORT';
}

interface ConsoleErrorObservation {
  readonly timestamp: string;
  readonly observedAt: number;
  readonly text: string;
}

const DUPLICATE_ABORT_WINDOW_MS = 250;

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !['authorization', 'cookie', 'set-cookie'].includes(key.toLowerCase())));
}

function sanitizeBody(body: string): string {
  return body.replace(/Bearer\s+[\w.-]+/gi, 'Bearer [REDACTED]').slice(0, 2_000);
}

function isTargetBuildingsRequest(url: string): boolean {
  return /^https?:\/\/[^/]+\/tenants\/[^/]+\/buildings$/.test(url);
}

/**
 * Collected browser observability signals for a single test.
 * All arrays are append-only; consumers inspect them at test teardown.
 */
export interface BrowserObservability {
  /** Unhandled page errors (page.on('pageerror')) */
  readonly pageErrors: string[];
  /** Console error messages (console.error) */
  readonly consoleErrors: string[];
  /** Console errors retained with timestamps for diagnostic correlation. */
  readonly consoleErrorObservations: ConsoleErrorObservation[];
  /** Console errors not proven to be the synthetic benign duplicate-abort log. */
  readonly unexpectedConsoleErrors: string[];
  /** Console warnings, collected for diagnosis but not failed by default. */
  readonly consoleWarnings: string[];
  /** HTTP responses with status >= 500 */
  readonly http5xx: Http5xxObservation[];
  /** Post-login HTTP responses with status 401. */
  readonly http401: Array<{ url: string; statusText: string }>;
  /** Target buildings request lifecycle for network diagnosis. */
  readonly targetBuildings: TargetBuildingsObservation[];
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
export function attachBrowserObservability(page: Page, context: ObservabilityTestContext = {}): BrowserObservability {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleErrorObservations: ConsoleErrorObservation[] = [];
  const consoleWarnings: string[] = [];
  const http5xx: Http5xxObservation[] = [];
  const http401: Array<{ url: string; statusText: string }> = [];
  const targetBuildings: TargetBuildingsObservation[] = [];
  const targetByRequest = new WeakMap<object, TargetBuildingsObservation>();

  const classifyBenignDuplicateAborts = (): void => {
    for (const observation of targetBuildings) {
      if (
        observation.requestFailureErrorText !== 'net::ERR_ABORTED' ||
        observation.method !== 'GET' ||
        !isTargetBuildingsRequest(observation.url) ||
        observation.requestFailedAt === undefined
      ) {
        continue;
      }

      const sibling = targetBuildings.find((candidate) =>
        candidate !== observation &&
        candidate.method === observation.method &&
        candidate.url === observation.url &&
        candidate.responseStatus !== undefined &&
        candidate.responseStatus >= 200 &&
        candidate.responseStatus < 300 &&
        candidate.requestFailureErrorText === undefined &&
        Math.abs(candidate.requestStartedAt - observation.requestStartedAt) <= DUPLICATE_ABORT_WINDOW_MS,
      );

      if (sibling) {
        observation.benignClassification = 'BENIGN_DUPLICATE_ABORT';
      }
    }
  };

  const getBenignDuplicateAborts = (): TargetBuildingsObservation[] => {
    classifyBenignDuplicateAborts();
    return targetBuildings.filter((observation) => observation.benignClassification === 'BENIGN_DUPLICATE_ABORT');
  };

  const isBenignSyntheticConsoleError = (
    observation: ConsoleErrorObservation,
    benignAborts: TargetBuildingsObservation[],
    consumedAborts: Set<TargetBuildingsObservation>,
  ): boolean => {
    const match = observation.text.match(/^\[error\] \[API ERROR\] (\/tenants\/[^/\s]+\/buildings) \(500\) Failed to fetch$/);
    if (!match) return false;

    const eligibleAborts = benignAborts
      .filter((target) =>
        !consumedAborts.has(target) &&
        target.requestFailedAt !== undefined &&
        new URL(target.url).pathname === match[1] &&
        Math.abs(observation.observedAt - target.requestFailedAt) <= DUPLICATE_ABORT_WINDOW_MS,
      )
      .sort((left, right) =>
        Math.abs(observation.observedAt - left.requestFailedAt!) -
        Math.abs(observation.observedAt - right.requestFailedAt!),
      );

    const benignAbort = eligibleAborts[0];
    if (benignAbort) consumedAborts.add(benignAbort);

    return benignAbort !== undefined;
  };

  const onPageError = (error: Error) => {
    pageErrors.push(error.message);
  };

  const onConsole = (msg: { type(): string; text(): string }) => {
    if (msg.type() === 'error') {
      const text = `[${msg.type()}] ${msg.text()}`;
      consoleErrors.push(text);
      consoleErrorObservations.push({
        timestamp: new Date().toISOString(),
        observedAt: Date.now(),
        text,
      });
    } else if (msg.type() === 'warning') {
      consoleWarnings.push(`[${msg.type()}] ${msg.text()}`);
    }
  };

  const onRequest = (request: { method(): string; url(): string }) => {
    if (isTargetBuildingsRequest(request.url())) {
      const target: TargetBuildingsObservation = {
        timestamp: new Date().toISOString(),
        requestStartedAt: Date.now(),
        method: request.method(),
        url: request.url(),
        ...context,
      };
      targetBuildings.push(target);
      targetByRequest.set(request, target);
    }
  };

  const onResponse = (response: Response) => {
    const status = response.status();
    const request = response.request();
    const target = targetByRequest.get(request);
    if (target) {
      target.responseStatus = status;
      target.responseStatusText = response.statusText();
      target.responseAt = Date.now();
      target.responseHeaders = sanitizeHeaders(response.headers());
      if (status >= 500) {
        void response.text().then((body) => {
          target.responseBody = sanitizeBody(body);
        }).catch(() => {
          target.responseBody = '[unavailable]';
        });
      }
    }
    if (status >= 500) {
      const observation: Http5xxObservation = {
        timestamp: new Date().toISOString(),
        method: response.request().method(),
        url: response.url(),
        status,
        statusText: response.statusText(),
        headers: sanitizeHeaders(response.headers()),
        body: null,
        ...context,
      };
      http5xx.push(observation);
      void response.text().then((body) => {
        observation.body = sanitizeBody(body);
      }).catch(() => {
        observation.body = '[unavailable]';
      });
    }
    if (status === 401) {
      http401.push({
        url: response.url(),
        statusText: response.statusText(),
      });
    }
  };

  const onRequestFailed = (request: { method(): string; url(): string; failure(): { errorText: string } | null }) => {
    const target = targetByRequest.get(request);
      if (target) {
        target.requestFailureErrorText = request.failure()?.errorText ?? '[unavailable]';
        target.requestFailedAt = Date.now();
    }
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  let detached = false;

  return {
    pageErrors,
    consoleErrors,
    consoleErrorObservations,
    get unexpectedConsoleErrors() {
      const benignAborts = getBenignDuplicateAborts();
      const consumedAborts = new Set<TargetBuildingsObservation>();
      return consoleErrorObservations
        .filter((observation) => !isBenignSyntheticConsoleError(observation, benignAborts, consumedAborts))
        .map((observation) => observation.text);
    },
    consoleWarnings,
    http5xx,
    http401,
    targetBuildings,
    detach() {
      if (detached) return;
      detached = true;
      page.removeListener('pageerror', onPageError);
      page.removeListener('console', onConsole);
      page.removeListener('request', onRequest);
      page.removeListener('response', onResponse);
      page.removeListener('requestfailed', onRequestFailed);
    },
  } satisfies BrowserObservability;
}
