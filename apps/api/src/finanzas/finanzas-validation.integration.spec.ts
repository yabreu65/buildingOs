import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request = require('supertest');
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { RecurringExpenseController } from './recurring-expense.controller';
import { RecurringExpenseService } from './recurring-expense.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { BuildingAccessGuard } from '../tenancy/building-access.guard';

const mockExpensesService = {
  listExpenses: jest.fn().mockResolvedValue([]),
  importExpensesFromExcel: jest.fn().mockResolvedValue({
    successCount: 0,
    failureCount: 0,
    errors: [],
  }),
};

const mockRecurringExpenseService = {
  createRecurringExpense: jest.fn().mockResolvedValue({
    id: 're-1',
    categoryId: 'cat-1',
    amount: 5000,
    currency: 'ARS',
    concept: 'Test',
    frequency: 'MONTHLY',
    isActive: true,
  }),
  listRecurringExpenses: jest.fn().mockResolvedValue([]),
  updateRecurringExpense: jest.fn().mockResolvedValue({
    id: 're-1',
    categoryId: 'cat-1',
    amount: 5000,
    currency: 'ARS',
    concept: 'Test',
    frequency: 'MONTHLY',
    isActive: true,
  }),
};

const alwaysPass: CanActivate = { canActivate: () => true };

describe('Finance ValidationPipe integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ExpensesController, RecurringExpenseController],
      providers: [
        { provide: ExpensesService, useValue: mockExpensesService },
        { provide: RecurringExpenseService, useValue: mockRecurringExpenseService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(alwaysPass)
      .overrideGuard(TenantAccessGuard)
      .useValue(alwaysPass)
      .overrideGuard(BuildingAccessGuard)
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ExpensesController — import/from-excel', () => {
    const baseUrl = '/tenants/t-1/finance/expenses/import/from-excel';

    it('rejects invalid period format', async () => {
      const res = await request(app.getHttpServer())
        .post(baseUrl)
        .send({ period: '2026/05', rows: [] });
      expect(res.status).toBe(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/period/i)]),
      );
    });

    it('rejects rows missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post(baseUrl)
        .send({ period: '2026-05', rows: [{ fecha: '01/05/2026' }] });
      expect(res.status).toBe(400);
    });

    it('rejects empty rows array (controller manual check)', async () => {
      const res = await request(app.getHttpServer())
        .post(baseUrl)
        .send({ period: '2026-05', rows: [] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/rows/i);
    });

    it('rejects missing rows', async () => {
      const res = await request(app.getHttpServer())
        .post(baseUrl)
        .send({ period: '2026-05' });
      expect(res.status).toBe(400);
    });

    it('does not call service when validation fails', async () => {
      await request(app.getHttpServer())
        .post(baseUrl)
        .send({ period: 'bad' });
      expect(mockExpensesService.importExpensesFromExcel).not.toHaveBeenCalled();
    });

    it('calls service for valid payload', async () => {
      await request(app.getHttpServer())
        .post(baseUrl)
        .send({
          period: '2026-05',
          rows: [
            {
              fecha: '01/05/2026',
              descripcion: 'Luz',
              monto: 100,
              moneda: 'ARS',
              edificio: 'Edificio A',
              categoria: 'Servicios',
            },
          ],
        });
      expect(mockExpensesService.importExpensesFromExcel).toHaveBeenCalled();
    });
  });

  describe('ExpensesController — listExpenses', () => {
    const baseUrl = '/tenants/t-1/finance/expenses';

    it('rejects invalid period format', async () => {
      const res = await request(app.getHttpServer())
        .get(baseUrl)
        .query({ period: '2026-13' });
      expect(res.status).toBe(400);
    });

    it('rejects limit of 0', async () => {
      const res = await request(app.getHttpServer())
        .get(baseUrl)
        .query({ limit: 0 });
      expect(res.status).toBe(400);
    });

    it('rejects decimal limit', async () => {
      const res = await request(app.getHttpServer())
        .get(baseUrl)
        .query({ limit: 10.5 });
      expect(res.status).toBe(400);
    });

    it('rejects negative offset', async () => {
      const res = await request(app.getHttpServer())
        .get(baseUrl)
        .query({ offset: -1 });
      expect(res.status).toBe(400);
    });

    it('rejects non-numeric limit', async () => {
      const res = await request(app.getHttpServer())
        .get(baseUrl)
        .query({ limit: 'abc' });
      expect(res.status).toBe(400);
    });
  });

  describe('RecurringExpenseController — create', () => {
    const baseUrl = '/buildings/b-1/recurring-expenses';

    it('rejects decimal amount', async () => {
      const res = await request(app.getHttpServer())
        .post(baseUrl)
        .send({
          categoryId: 'cat-1',
          amount: 10.5,
          currency: 'ARS',
          concept: 'Test',
          frequency: 'MONTHLY',
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/amount/i)]),
      );
    });

    it('rejects invalid currency', async () => {
      const res = await request(app.getHttpServer())
        .post(baseUrl)
        .send({
          categoryId: 'cat-1',
          amount: 5000,
          currency: 'EUR',
          concept: 'Test',
          frequency: 'MONTHLY',
        });
      expect(res.status).toBe(400);
    });

    it('rejects invalid frequency', async () => {
      const res = await request(app.getHttpServer())
        .post(baseUrl)
        .send({
          categoryId: 'cat-1',
          amount: 5000,
          currency: 'ARS',
          concept: 'Test',
          frequency: 'WEEKLY',
        });
      expect(res.status).toBe(400);
    });

    it('rejects empty categoryId', async () => {
      const res = await request(app.getHttpServer())
        .post(baseUrl)
        .send({
          categoryId: '',
          amount: 5000,
          currency: 'ARS',
          concept: 'Test',
          frequency: 'MONTHLY',
        });
      expect(res.status).toBe(400);
    });

    it('rejects empty concept', async () => {
      const res = await request(app.getHttpServer())
        .post(baseUrl)
        .send({
          categoryId: 'cat-1',
          amount: 5000,
          currency: 'ARS',
          concept: '',
          frequency: 'MONTHLY',
        });
      expect(res.status).toBe(400);
    });

    it('does not call service when validation fails', async () => {
      await request(app.getHttpServer())
        .post(baseUrl)
        .send({ categoryId: '', amount: -1, currency: 'X', concept: '', frequency: 'Y' });
      expect(mockRecurringExpenseService.createRecurringExpense).not.toHaveBeenCalled();
    });

    it('calls service for valid payload', async () => {
      await request(app.getHttpServer())
        .post(baseUrl)
        .send({
          categoryId: 'cat-1',
          amount: 5000,
          currency: 'ARS',
          concept: 'Expensas mensuales',
          frequency: 'MONTHLY',
        });
      expect(mockRecurringExpenseService.createRecurringExpense).toHaveBeenCalled();
    });
  });

  describe('RecurringExpenseController — update', () => {
    const baseUrl = '/buildings/b-1/recurring-expenses/re-1';

    it('accepts true as isActive', async () => {
      const res = await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ isActive: true });
      expect(res.status).toBe(200);
    });

    it('accepts false as isActive', async () => {
      const res = await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ isActive: false });
      expect(res.status).toBe(200);
    });

    it('rejects 0 as isActive', async () => {
      const res = await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ isActive: 0 });
      expect(res.status).toBe(400);
    });

    it('rejects 1 as isActive', async () => {
      const res = await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ isActive: 1 });
      expect(res.status).toBe(400);
    });

    it('rejects "true" as isActive', async () => {
      const res = await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ isActive: 'true' });
      expect(res.status).toBe(400);
    });

    it('rejects "false" as isActive', async () => {
      const res = await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ isActive: 'false' });
      expect(res.status).toBe(400);
    });

    it('rejects "yes" as isActive', async () => {
      const res = await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ isActive: 'yes' });
      expect(res.status).toBe(400);
    });

    it('rejects object as isActive', async () => {
      const res = await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ isActive: { invalid: true } });
      expect(res.status).toBe(400);
    });

    it('rejects array as isActive', async () => {
      const res = await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ isActive: [1] });
      expect(res.status).toBe(400);
    });

    it('does not call service when isActive validation fails', async () => {
      await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ isActive: 0 });
      expect(mockRecurringExpenseService.updateRecurringExpense).not.toHaveBeenCalled();
    });

    it('rejects decimal amount', async () => {
      const res = await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ amount: 10.5 });
      expect(res.status).toBe(400);
    });

    it('rejects empty concept', async () => {
      const res = await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ concept: '' });
      expect(res.status).toBe(400);
    });

    it('does not call service when validation fails', async () => {
      await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ isActive: { invalid: true }, amount: 1.5, concept: '' });
      expect(mockRecurringExpenseService.updateRecurringExpense).not.toHaveBeenCalled();
    });

    it('calls service for valid payload', async () => {
      await request(app.getHttpServer())
        .patch(baseUrl)
        .send({ amount: 7500, concept: 'Updated' });
      expect(mockRecurringExpenseService.updateRecurringExpense).toHaveBeenCalled();
    });
  });
});
