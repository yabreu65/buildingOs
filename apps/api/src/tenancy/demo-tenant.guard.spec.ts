import { Controller, Get, Head, Post, Put, Patch, Delete } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { DemoTenantGuard } from './demo-tenant.guard';
import { ReleaseAWriteBarrierService } from './release-a-write-barrier.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
class BarrierTestController {
  static handler = jest.fn(() => ({ ok: true }));

  @Post('mutations/:tenantId')
  post() { return BarrierTestController.handler(); }

  @Put('mutations/:tenantId')
  put() { return BarrierTestController.handler(); }

  @Patch('mutations/:tenantId')
  patch() { return BarrierTestController.handler(); }

  @Delete('mutations/:tenantId')
  delete() { return BarrierTestController.handler(); }

  @Get('health')
  health() { return { status: 'ok' }; }

  @Get('ready')
  ready() { return { status: 'healthy' }; }

  @Get('readyz')
  readyz() { return { status: 'healthy' }; }

  @Head('health')
  headHealth() { return { status: 'ok' }; }
}

describe('DemoTenantGuard with Release A write barrier', () => {
  let app: INestApplication;
  let httpServer: Server;

  const prisma = {
    tenant: { findUnique: jest.fn() },
  };
  const barrier = { isOpen: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BarrierTestController],
      providers: [
        { provide: ReleaseAWriteBarrierService, useValue: barrier },
        { provide: PrismaService, useValue: prisma },
        DemoTenantGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalGuards(moduleRef.get(DemoTenantGuard));
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    barrier.isOpen.mockReturnValue(false);
    BarrierTestController.handler.mockClear();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)(
    'rejects %s with explicit maintenance 503 before Prisma or handler calls',
    async (method) => {
      const response = await request(httpServer)[method]('/mutations/tenant-a').expect(503);

      expect(JSON.stringify(response.body)).toMatch(/maintenance/i);
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
      expect(BarrierTestController.handler).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['GET health', () => request(httpServer).get('/health')],
    ['HEAD health', () => request(httpServer).head('/health')],
    ['GET readiness', () => request(httpServer).get('/ready')],
    ['GET readyz', () => request(httpServer).get('/readyz')],
  ])('allows %s while the barrier is closed without Prisma access', async (_label, send) => {
    await send().expect(200);

    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(barrier.isOpen).not.toHaveBeenCalled();
  });

  it('continues through normal tenant validation and handler behavior after release', async () => {
    barrier.isOpen.mockReturnValue(true);
    prisma.tenant.findUnique.mockResolvedValue({ isDemo: false });

    await request(httpServer).post('/mutations/tenant-a').expect(201, { ok: true });

    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
    expect(BarrierTestController.handler).toHaveBeenCalledTimes(1);
  });

  it('applies the closed-state barrier before tenant lookup for direct guard activation', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', params: { tenantId: 'tenant-a' } }),
      }),
    } as ExecutionContext;
    const guard = new DemoTenantGuard(prisma as never, barrier as never);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 503 });
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('preserves the demo assistant mutation exception after release', async () => {
    barrier.isOpen.mockReturnValue(true);
    const guard = new DemoTenantGuard(prisma as never, barrier as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          originalUrl: '/tenants/demo-1/assistant/chat/v2',
          params: { tenantId: 'demo-1' },
        }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('preserves demo-tenant mutation blocking after release', async () => {
    barrier.isOpen.mockReturnValue(true);
    prisma.tenant.findUnique.mockResolvedValue({ isDemo: true });
    const guard = new DemoTenantGuard(prisma as never, barrier as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          originalUrl: '/tenants/demo-1/tickets',
          params: { tenantId: 'demo-1' },
        }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toThrow(
      'This demo environment is read-only',
    );
  });
});
