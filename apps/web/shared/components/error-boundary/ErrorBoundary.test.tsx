import React from 'react';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';
import { clearLatestApiResponseContext, recordApiResponseContext } from '@/shared/lib/observability/frontend-observability';

describe('ErrorBoundary', () => {
  beforeEach(() => {
    clearLatestApiResponseContext();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the page fallback and shows the request reference when available', () => {
    recordApiResponseContext({
      requestId: 'request-abc',
      method: 'GET',
      path: '/ready',
      statusCode: 503,
    });

    function Boom(): React.JSX.Element {
      throw new Error('boom');
    }

    render(
      <ErrorBoundary level="page">
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Algo salió mal')).toBeTruthy();
    expect(screen.getByText(/Reference:/).textContent).toContain('request-abc');
  });

  it('renders a custom fallback when provided', () => {
    function Boom(): React.JSX.Element {
      throw new Error('boom');
    }

    render(
      <ErrorBoundary fallback={<div data-testid="fallback">custom</div>}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('fallback')).toBeTruthy();
  });
});
