'use client';

import React, { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  level?: 'page' | 'feature' | 'component';
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Error Boundary component for catching React errors
 *
 * Usage:
 * <ErrorBoundary level="page" fallback={<ErrorPage />}>
 *   <MyComponent />
 * </ErrorBoundary>
 *
 * Levels:
 * - page: Full page replacement on error
 * - feature: Feature-level error with inline fallback
 * - component: Component-level with minimal error display
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught:', error, errorInfo);
    }

    // Update state
    this.setState({ errorInfo });

    // Call optional error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // TODO: Send error to Sentry or error tracking service
    // Sentry.captureException(error, { contexts: { errorBoundary: errorInfo } });
  }

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI based on level
      const level = this.props.level || 'component';

      if (level === 'page') {
        return <ErrorPageFallback error={this.state.error} />;
      }

      if (level === 'feature') {
        return <ErrorFeatureFallback error={this.state.error} />;
      }

      // component level
      return <ErrorComponentFallback error={this.state.error} />;
    }

    return this.props.children;
  }
}

// ============================================================================
// Fallback Components
// ============================================================================

function ErrorPageFallback({ error }: { error: Error | null }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-4 text-center">
        <div className="text-5xl">⚠️</div>
        <h1 className="text-2xl font-bold text-foreground">
          Algo salió mal
        </h1>
        <p className="text-muted-foreground">
          {process.env.NODE_ENV === 'development' && error
            ? error.message
            : 'Ocurrió un error inesperado. Por favor, intenta recargar la página.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        >
          Recargar página
        </button>
      </div>
    </div>
  );
}

function ErrorFeatureFallback({ error }: { error: Error | null }) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
      <div className="flex gap-3">
        <div className="text-2xl">⚠️</div>
        <div>
          <h3 className="font-semibold text-destructive">
            Error en esta sección
          </h3>
          <p className="text-sm text-muted-foreground">
            {process.env.NODE_ENV === 'development' && error
              ? error.message
              : 'Hubo un problema cargando esta sección. Intenta recargar la página.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorComponentFallback({ error }: { error: Error | null }) {
  return (
    <div className="text-xs text-muted-foreground">
      {process.env.NODE_ENV === 'development' && error ? (
        <details className="cursor-pointer">
          <summary>Error: {error.message}</summary>
          <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-left">
            {error.stack}
          </pre>
        </details>
      ) : (
        'Error al cargar componente'
      )}
    </div>
  );
}
