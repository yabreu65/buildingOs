import { MetricsService } from './metrics.service';
import type { HealthStatus } from './health.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('renders Prometheus text with request and readiness metrics without secrets', () => {
    service.recordHttpRequest({
      method: 'GET',
      route: 'GET /ready',
      statusCode: 200,
      durationMs: 42,
    });
    service.recordHttpRequest({
      method: 'POST',
      route: 'POST /auth/login',
      statusCode: 401,
      durationMs: 17,
    });

    service.recordReadiness({
      status: 'degraded',
      timestamp: '2026-07-03T18:00:00.000Z',
      checks: {
        database: { status: 'up', latency: 2 },
        storage: { status: 'down', error: 'storage unavailable' },
        email: { status: 'up', provider: 'smtp' },
      },
    } satisfies HealthStatus);

    const output = service.renderPrometheus();

    expect(output).toContain('# TYPE buildingos_http_requests_total counter');
    expect(output).toContain('buildingos_http_requests_total{method="GET",route="GET /ready",status_code="200"} 1');
    expect(output).toContain('buildingos_http_request_duration_ms_bucket{method="GET",route="GET /ready",status_code="200",le="50"} 1');
    expect(output).toContain('buildingos_readiness_overall_status{status="degraded"} 1');
    expect(output).toContain('buildingos_readiness_dependency_state{dependency="storage",state="down"} 1');
    expect(output).not.toMatch(/authorization|cookie|x-api-key|secret/i);
  });

  it('exposes uptime even before any requests are recorded', () => {
    const output = service.renderPrometheus();

    expect(output).toContain('buildingos_process_uptime_seconds');
  });
});
