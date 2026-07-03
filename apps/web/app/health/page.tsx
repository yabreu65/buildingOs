'use client';

import { useEffect, useState } from 'react';
import { buildPublicApiUrl } from '@/shared/lib/public-api-url';
import {
  recordApiResponseContext,
  getLatestApiResponseContext,
  type ApiResponseContext,
} from '@/shared/lib/observability/frontend-observability';

interface HealthPayload {
  readonly status: string;
  readonly timestamp?: string;
  readonly checks?: Record<string, unknown>;
  readonly error?: string;
}

interface HealthPanelState {
  readonly liveness: HealthPayload | null;
  readonly readiness: HealthPayload | null;
  readonly error?: string;
}

export default function HealthPage() {
  const [state, setState] = useState<HealthPanelState>({
    liveness: null,
    readiness: null,
  });
  const [loading, setLoading] = useState(true);
  const [requestContext, setRequestContext] = useState<ApiResponseContext | null>(null);

  useEffect(() => {
    const loadHealth = async () => {
      try {
        const [livenessResponse, readinessResponse] = await Promise.all([
          fetch(buildPublicApiUrl('/health')),
          fetch(buildPublicApiUrl('/ready')),
        ]);

        recordApiResponseContext({
          requestId: readinessResponse.headers.get('X-Request-Id') ?? undefined,
          method: 'GET',
          path: '/ready',
          statusCode: readinessResponse.status,
        });

        const [liveness, readiness] = await Promise.all([
          livenessResponse.json() as Promise<HealthPayload>,
          readinessResponse.json() as Promise<HealthPayload>,
        ]);

        setState({ liveness, readiness });
        setRequestContext(getLatestApiResponseContext());
      } catch (error) {
        setState({
          liveness: null,
          readiness: null,
          error: error instanceof Error ? error.message : 'Error desconocido',
        });
        setRequestContext(getLatestApiResponseContext());
      } finally {
        setLoading(false);
      }
    };

    loadHealth();
  }, []);

  return (
    <div className="p-10">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">System Health</h1>
        {requestContext?.requestId ? (
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            Request ID: <span className="font-mono">{requestContext.requestId}</span>
          </span>
        ) : null}
      </div>

      {loading ? (
        <p>Checking API...</p>
      ) : state.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {state.error}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <pre className="overflow-auto rounded-md bg-muted p-4 text-sm">
            {JSON.stringify(state.liveness, null, 2)}
          </pre>
          <pre className="overflow-auto rounded-md bg-muted p-4 text-sm">
            {JSON.stringify(state.readiness, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
