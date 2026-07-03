import { ConfigService } from '../config/config.service';
import { EmailService } from '../email/email.service';
import { MinioService } from '../storage/minio.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';
import { HealthService, type HealthStatus } from './health.service';

describe('HealthService', () => {
  const configServiceMock = {
    get: jest.fn(),
  };
  const prismaMock = {
    $queryRaw: jest.fn(),
  };
  const minioMock = {
    checkHealth: jest.fn(),
  };
  const emailMock = {
    checkHealth: jest.fn(),
  };
  const metricsMock = {
    recordReadiness: jest.fn(),
  };

  const service = new HealthService(
    configServiceMock as unknown as ConfigService,
    prismaMock as unknown as PrismaService,
    minioMock as unknown as MinioService,
    emailMock as unknown as EmailService,
    metricsMock as unknown as MetricsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns healthy when the database is up and optional dependencies are not configured', async () => {
    configServiceMock.get.mockReturnValue({ s3Endpoint: undefined, s3Bucket: undefined });
    prismaMock.$queryRaw.mockResolvedValue(undefined);
    emailMock.checkHealth.mockResolvedValue({ status: 'not_configured', provider: 'none' });

    const readiness = await service.getReadiness();

    expect(readiness.status).toBe('healthy');
    expect(readiness.checks.database.status).toBe('up');
    expect(readiness.checks.storage.status).toBe('not_configured');
    expect(readiness.checks.email.status).toBe('not_configured');
    expect(metricsMock.recordReadiness).toHaveBeenCalledWith(readiness);
  });

  it('returns degraded when the database is up but an optional configured dependency fails', async () => {
    configServiceMock.get.mockReturnValue({ s3Endpoint: 'http://minio:9000', s3Bucket: 'buildingos' });
    prismaMock.$queryRaw.mockResolvedValue(undefined);
    minioMock.checkHealth.mockResolvedValue({ status: 'down', error: 'storage unavailable' });
    emailMock.checkHealth.mockResolvedValue({ status: 'up', provider: 'smtp' });

    const readiness = await service.getReadiness();

    expect(readiness.status).toBe('degraded');
    expect(readiness.checks.storage.status).toBe('down');
    expect(readiness.checks.email.status).toBe('up');
  });

  it('returns unhealthy when the database check fails and hides raw database details', async () => {
    configServiceMock.get.mockReturnValue({ s3Endpoint: undefined, s3Bucket: undefined });
    prismaMock.$queryRaw.mockRejectedValue(new Error('password authentication failed for user buildingos'));
    emailMock.checkHealth.mockResolvedValue({ status: 'not_configured', provider: 'none' });

    const readiness = await service.getReadiness();

    expect(readiness.status).toBe('unhealthy');
    expect(readiness.checks.database.status).toBe('down');
    expect(readiness.checks.database.error).toContain('Database readiness check failed');
    expect(readiness.checks.database.error).not.toContain('password authentication failed');
  });

  it('returns a typed HealthStatus payload', async () => {
    configServiceMock.get.mockReturnValue({ s3Endpoint: undefined, s3Bucket: undefined });
    prismaMock.$queryRaw.mockResolvedValue(undefined);
    emailMock.checkHealth.mockResolvedValue({ status: 'not_configured', provider: 'none' });

    const readiness: HealthStatus = await service.getReadiness();

    expect(readiness.timestamp).toEqual(expect.any(String));
  });
});
