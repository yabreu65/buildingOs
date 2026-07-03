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

type ReadinessStatus = 'ok' | 'degraded' | 'unhealthy' | string;

function getStatusTone(status?: ReadinessStatus): 'success' | 'warning' | 'danger' | 'muted' {
  switch (status) {
    case 'ok':
      return 'success';
    case 'degraded':
      return 'warning';
    case 'unhealthy':
      return 'danger';
    default:
      return 'muted';
  }
}

function getStatusLabel(status?: ReadinessStatus): string {
  switch (status) {
    case 'ok':
      return 'Servicio operativo';
    case 'degraded':
      return 'Servicio degradado';
    case 'unhealthy':
      return 'Servicio no disponible';
    default:
      return 'Estado desconocido';
  }
}

function getStatusDescription(status?: ReadinessStatus): string {
  switch (status) {
    case 'ok':
      return 'Las dependencias críticas responden correctamente.';
    case 'degraded':
      return 'La API responde, pero una o más dependencias no críticas están fallando.';
    case 'unhealthy':
      return 'La API no está lista para recibir tráfico.';
    default:
      return 'No se pudo determinar el estado actual.';
  }
}

function summarizeChecks(checks?: Record<string, unknown>): Array<{ name: string; status: string }> {
  if (!checks) {
    return [];
  }

  return Object.entries(checks).map(([name, value]) => {
    if (value && typeof value === 'object' && 'status' in value) {
      const statusValue = Reflect.get(value as Record<string, unknown>, 'status');
      return { name, status: typeof statusValue === 'string' ? statusValue : 'unknown' };
    }

    return { name, status: 'available' };
  });
}

export default function HealthPage() {
  const isProduction = process.env.NODE_ENV === 'production';
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
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          Estado público del sistema
        </span>
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
          <section className="rounded-md border border-border bg-card p-4">
            <p className="text-sm font-medium text-muted-foreground">Liveness</p>
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                  state.liveness?.status === 'ok'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {state.liveness?.status === 'ok' ? 'OK' : 'Sin señal'}
              </span>
            </div>
            <p className="mt-3 text-lg font-semibold">
              {state.liveness?.status === 'ok' ? 'Servicio activo' : 'Servicio sin señal'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              El proceso responde y el servidor está arriba.
            </p>
            {state.liveness?.timestamp ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Última verificación:{' '}
                <span className="font-mono">{state.liveness.timestamp}</span>
              </p>
            ) : null}
          </section>

          <section className="rounded-md border border-border bg-card p-4">
            <p className="text-sm font-medium text-muted-foreground">Readiness</p>
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                  getStatusTone(state.readiness?.status) === 'success'
                    ? 'bg-emerald-100 text-emerald-700'
                    : getStatusTone(state.readiness?.status) === 'warning'
                    ? 'bg-amber-100 text-amber-700'
                    : getStatusTone(state.readiness?.status) === 'danger'
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {getStatusLabel(state.readiness?.status)}
              </span>
            </div>
            <p className="mt-3 text-lg font-semibold">{getStatusLabel(state.readiness?.status)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {getStatusDescription(state.readiness?.status)}
            </p>
            {state.readiness?.timestamp ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Última verificación:{' '}
                <span className="font-mono">{state.readiness.timestamp}</span>
              </p>
            ) : null}

            {!isProduction && state.readiness?.checks ? (
              <details className="mt-4 rounded-md border border-border/60 bg-muted/40 p-3">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  Detalle técnico para desarrollo
                </summary>
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {summarizeChecks(state.readiness.checks).map((check) => (
                    <li key={check.name} className="flex items-center justify-between gap-4">
                      <span className="font-medium text-foreground">{check.name}</span>
                      <span className="font-mono">{check.status}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
