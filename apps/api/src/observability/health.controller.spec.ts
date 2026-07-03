import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from './health.controller';
import { HealthService, type HealthStatus } from './health.service';

describe('HealthController', () => {
  let app: import('@nestjs/common').INestApplication;
  const healthServiceMock = {
    getReadiness: jest.fn(),
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: healthServiceMock,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    healthServiceMock.getReadiness.mockReset();
  });

  afterEach(async () => {
    await app.close();
  });

  it('keeps /health lightweight and does not invoke readiness checks', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body.status).toBe('ok');
    expect(typeof response.body.timestamp).toBe('string');
    expect(healthServiceMock.getReadiness).not.toHaveBeenCalled();
  });

  it('returns healthy readiness at /ready and /readyz', async () => {
    const readiness: HealthStatus = {
      status: 'healthy',
      timestamp: '2026-07-03T18:00:00.000Z',
      checks: {
        database: { status: 'up', latency: 2 },
        storage: { status: 'not_configured' },
        email: { status: 'not_configured', provider: 'none' },
      },
    };
    healthServiceMock.getReadiness.mockResolvedValue(readiness);

    await request(app.getHttpServer())
      .get('/ready')
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('healthy');
        expect(response.body.checks.database.status).toBe('up');
      });

    await request(app.getHttpServer())
      .get('/readyz')
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('healthy');
      });

    expect(healthServiceMock.getReadiness).toHaveBeenCalledTimes(2);
  });

  it('returns degraded readiness without failing routing when optional dependencies are down', async () => {
    healthServiceMock.getReadiness.mockResolvedValue({
      status: 'degraded',
      timestamp: '2026-07-03T18:00:00.000Z',
      checks: {
        database: { status: 'up', latency: 2 },
        storage: { status: 'down', error: 'storage unavailable' },
        email: { status: 'up', provider: 'smtp' },
      },
    } satisfies HealthStatus);

    await request(app.getHttpServer())
      .get('/ready')
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('degraded');
      });
  });

  it('returns 503 when readiness is unhealthy', async () => {
    healthServiceMock.getReadiness.mockResolvedValue({
      status: 'unhealthy',
      timestamp: '2026-07-03T18:00:00.000Z',
      checks: {
        database: { status: 'down', error: 'db unavailable' },
        storage: { status: 'not_configured' },
        email: { status: 'not_configured', provider: 'none' },
      },
    } satisfies HealthStatus);

    const response = await request(app.getHttpServer()).get('/ready').expect(503);

    expect(response.body.status).toBe('unhealthy');
  });
});
