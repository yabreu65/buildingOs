'use client';

import { useEffect } from 'react';
import { getLatestApiResponseContext, reportFrontendError } from '@/shared/lib/observability/frontend-observability';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportFrontendError(error, {
      source: 'app-error',
      path: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }, [error]);

  const requestContext = getLatestApiResponseContext();

  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-xl space-y-4 text-center">
        <div className="text-5xl">⚠️</div>
        <h1 className="text-2xl font-bold">Algo salió mal</h1>
        <p className="text-muted-foreground">
          La aplicación encontró un error inesperado. Reintenta la acción o recarga la página.
        </p>
        {process.env.NODE_ENV === 'development' ? (
          <pre className="overflow-auto rounded-lg bg-muted p-4 text-left text-sm">
            {error.message}
          </pre>
        ) : null}
        {requestContext?.requestId ? (
          <p className="text-xs text-muted-foreground">
            Reference: <span className="font-mono">{requestContext.requestId}</span>
          </p>
        ) : null}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            Reintentar
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-border px-4 py-2 hover:bg-muted"
          >
            Recargar
          </button>
        </div>
      </div>
    </div>
  );
}
