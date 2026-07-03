export interface ApiResponseContext {
  readonly requestId?: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly timestamp: string;
}

export interface FrontendErrorContext {
  readonly source: 'api-client' | 'error-boundary' | 'app-error';
  readonly level?: 'page' | 'feature' | 'component';
  readonly componentStack?: string;
  readonly path?: string;
}

let latestApiResponseContext: ApiResponseContext | null = null;

export function recordApiResponseContext(context: Omit<ApiResponseContext, 'timestamp'>): void {
  latestApiResponseContext = {
    ...context,
    timestamp: new Date().toISOString(),
  };
}

export function getLatestApiResponseContext(): ApiResponseContext | null {
  return latestApiResponseContext;
}

export function clearLatestApiResponseContext(): void {
  latestApiResponseContext = null;
}

export function reportFrontendError(error: Error, context: FrontendErrorContext): void {
  const payload = {
    errorName: error.name,
    message: error.message,
    context,
    apiResponse: latestApiResponseContext,
    path: typeof window !== 'undefined' ? window.location.pathname : undefined,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
  };

  console.error('[BuildingOS Frontend Observability]', payload, error);
}
