import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import type { HealthStatus } from './health.service';

describe('MetricsController', () => {
  let app: import('@nestjs/common').INestApplication;
  let metricsService: MetricsService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [MetricsService],
    }).compile();

    app = moduleRef.createNestApplication();
    metricsService = moduleRef.get(MetricsService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('exposes Prometheus text with readiness state and request metrics', async () => {
    metricsService.recordHttpRequest({
      method: 'GET',
      route: 'GET /ready',
      statusCode: 200,
      durationMs: 11,
    });
    metricsService.recordReadiness({
      status: 'healthy',
      timestamp: '2026-07-03T18:00:00.000Z',
      checks: {
        database: { status: 'up', latency: 2 },
        storage: { status: 'not_configured' },
        email: { status: 'not_configured', provider: 'none' },
      },
    } satisfies HealthStatus);

    const response = await request(app.getHttpServer()).get('/metrics').expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toContain('buildingos_http_requests_total');
    expect(response.text).toContain('buildingos_readiness_overall_status{status="healthy"} 1');
    expect(response.text).not.toMatch(/authorization|cookie|x-api-key|secret/i);
  });
});
