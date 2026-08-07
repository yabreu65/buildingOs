import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request = require('supertest');
import { TenantFinanceController } from './tenant-finance.controller';
import { FinanzasService } from './finanzas.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';

const mockFinanzasService = {
  getPaymentAuditLog: jest.fn().mockResolvedValue([]),
};

const alwaysPass: CanActivate = { canActivate: () => true };

describe('TenantFinanceController — getPaymentAuditLog HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TenantFinanceController],
      providers: [
        { provide: FinanzasService, useValue: mockFinanzasService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(alwaysPass)
      .overrideGuard(TenantAccessGuard)
      .useValue(alwaysPass)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.tenantId = 't-1';
      req.user = {
        id: 'user-1',
        roles: ['TENANT_ADMIN'],
        membershipId: 'member-1',
      };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const baseUrl = '/tenants/t-1/finance/payments/p-1/audit';

  it('returns 200 with valid limit', async () => {
    const res = await request(app.getHttpServer())
      .get(baseUrl)
      .query({ limit: 20 });
    expect(res.status).toBe(200);
  });

  it('passes limit as number to the service', async () => {
    await request(app.getHttpServer())
      .get(baseUrl)
      .query({ limit: 20 });
    expect(mockFinanzasService.getPaymentAuditLog).toHaveBeenCalledWith(
      't-1',
      'p-1',
      expect.objectContaining({ limit: 20 }),
    );
  });

  it('returns 200 when limit is absent (optional field)', async () => {
    const res = await request(app.getHttpServer()).get(baseUrl);
    expect(res.status).toBe(200);
  });

  it('returns 200 when limit is 1 (minimum)', async () => {
    const res = await request(app.getHttpServer())
      .get(baseUrl)
      .query({ limit: 1 });
    expect(res.status).toBe(200);
  });

  it('returns 200 when limit is 200 (maximum)', async () => {
    const res = await request(app.getHttpServer())
      .get(baseUrl)
      .query({ limit: 200 });
    expect(res.status).toBe(200);
  });

  it('rejects limit=0 with 400', async () => {
    const res = await request(app.getHttpServer())
      .get(baseUrl)
      .query({ limit: 0 });
    expect(res.status).toBe(400);
  });

  it('rejects limit=-1 with 400', async () => {
    const res = await request(app.getHttpServer())
      .get(baseUrl)
      .query({ limit: -1 });
    expect(res.status).toBe(400);
  });

  it('rejects decimal limit with 400', async () => {
    const res = await request(app.getHttpServer())
      .get(baseUrl)
      .query({ limit: 10.5 });
    expect(res.status).toBe(400);
  });

  it('rejects non-numeric limit with 400', async () => {
    const res = await request(app.getHttpServer())
      .get(baseUrl)
      .query({ limit: 'abc' });
    expect(res.status).toBe(400);
  });

  it('rejects limit>200 with 400', async () => {
    const res = await request(app.getHttpServer())
      .get(baseUrl)
      .query({ limit: 201 });
    expect(res.status).toBe(400);
  });

  it('does not call service when limit validation fails', async () => {
    await request(app.getHttpServer())
      .get(baseUrl)
      .query({ limit: 0 });
    expect(mockFinanzasService.getPaymentAuditLog).not.toHaveBeenCalled();
  });
});
