import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { IncomesController } from './incomes.controller';
import { IncomesService } from './incomes.service';
import { IncomeApplicationsService } from './income-applications.service';
import { LegacyIncomeBackfillService } from './legacy-income-backfill.service';

const alwaysPass: CanActivate = { canActivate: () => true };

describe('Legacy backfill HTTP validation (FIN-04R)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [IncomesController],
      providers: [
        { provide: IncomesService, useValue: { getIncome: jest.fn() } },
        { provide: IncomeApplicationsService, useValue: {} },
        {
          provide: LegacyIncomeBackfillService,
          useValue: {
            preview: jest.fn().mockResolvedValue([]),
            apply: jest.fn().mockResolvedValue([]),
          },
        },
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
      req.user = { id: 'user-1', roles: ['TENANT_ADMIN'], membershipId: 'member-1' };
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

  const applyUrl = '/tenants/t-1/finance/incomes/legacy-backfill/apply';
  const previewUrl = '/tenants/t-1/finance/incomes/legacy-backfill/preview';

  it('POST {} → 400', async () => {
    const res = await request(app.getHttpServer()).post(applyUrl).send({});
    expect(res.status).toBe(400);
  });

  it('POST {"items":null} → 400', async () => {
    const res = await request(app.getHttpServer()).post(applyUrl).send({ items: null });
    expect(res.status).toBe(400);
  });

  it('POST {"items":[]} → 400', async () => {
    const res = await request(app.getHttpServer()).post(applyUrl).send({ items: [] });
    expect(res.status).toBe(400);
  });

  it('POST 101 items → 400', async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ incomeId: `income-${i}` }));
    const res = await request(app.getHttpServer()).post(applyUrl).send({ items });
    expect(res.status).toBe(400);
  });

  it('POST item without incomeId → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(applyUrl)
      .send({ items: [{ fundId: 'fund-1' }] });
    expect(res.status).toBe(400);
  });

  it('POST empty incomeId → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(applyUrl)
      .send({ items: [{ incomeId: '' }] });
    expect(res.status).toBe(400);
  });

  it('POST numeric fundId → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(applyUrl)
      .send({ items: [{ incomeId: 'income-1', fundId: 123 }] });
    expect(res.status).toBe(400);
  });

  it('GET preview?destination=INVALID → 400', async () => {
    const res = await request(app.getHttpServer())
      .get(previewUrl)
      .query({ destination: 'INVALID' });
    expect(res.status).toBe(400);
  });

  it('GET preview?period=2026/05 → 400', async () => {
    const res = await request(app.getHttpServer()).get(previewUrl).query({ period: '2026/05' });
    expect(res.status).toBe(400);
  });

  it('GET preview valid → 200', async () => {
    const res = await request(app.getHttpServer())
      .get(previewUrl)
      .query({ period: '2026-08', destination: 'APPLY_TO_EXPENSES' });
    expect(res.status).toBe(200);
  });

  it('POST valid single item → 201', async () => {
    const res = await request(app.getHttpServer())
      .post(applyUrl)
      .send({ items: [{ incomeId: 'income-1' }] });
    expect(res.status).toBe(201);
  });
});
