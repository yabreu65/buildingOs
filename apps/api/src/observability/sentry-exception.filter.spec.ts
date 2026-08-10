import {
  ArgumentsHost,
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SentryExceptionFilter } from './sentry-exception.filter';
import { SentryService } from './sentry.service';
import { LoggerService } from './logger.service';

describe('SentryExceptionFilter', () => {
  const sentryService = {
    captureException: jest.fn(),
    captureMessage: jest.fn(),
  } as unknown as jest.Mocked<SentryService>;

  const loggerService = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<LoggerService>;

  function createHost(
    request: {
      id: string;
      tenantId?: string;
      userId?: string;
      routePath: string;
      path: string;
      method: string;
    },
    response: { status: jest.Mock; json: jest.Mock },
  ): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          id: request.id,
          tenantId: request.tenantId,
          userId: request.userId,
          route: { path: request.routePath },
          path: request.path,
          method: request.method,
        }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs 401 auth failures without sending them to Sentry', () => {
    const filter = new SentryExceptionFilter(sentryService, loggerService);
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = createHost(
      {
        id: 'req-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        routePath: '/auth/refresh',
        path: '/auth/refresh',
        method: 'POST',
      },
      response,
    );

    filter.catch(new UnauthorizedException('Sesión expirada'), host);

    expect(sentryService.captureException).not.toHaveBeenCalled();
    expect(sentryService.captureMessage).not.toHaveBeenCalled();
    expect(loggerService.info).toHaveBeenCalledWith(
      '[req-1] POST /auth/refresh - 401',
      expect.objectContaining({
        requestId: 'req-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        route: '/auth/refresh',
        method: 'POST',
        statusCode: 401,
        error: 'Sesión expirada',
      }),
    );
    expect(response.status).toHaveBeenCalledWith(401);
  });

  it('logs 403 authorization failures without sending them to Sentry', () => {
    const filter = new SentryExceptionFilter(sentryService, loggerService);
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = createHost(
      {
        id: 'req-2',
        tenantId: 'tenant-1',
        userId: 'user-1',
        routePath: '/tenants/tenant-1/finance',
        path: '/tenants/tenant-1/finance',
        method: 'GET',
      },
      response,
    );

    filter.catch(new ForbiddenException('Forbidden'), host);

    expect(sentryService.captureException).not.toHaveBeenCalled();
    expect(sentryService.captureMessage).not.toHaveBeenCalled();
    expect(loggerService.warn).toHaveBeenCalledWith(
      '[req-2] GET /tenants/tenant-1/finance - 403',
      expect.objectContaining({
        requestId: 'req-2',
        tenantId: 'tenant-1',
        userId: 'user-1',
        route: '/tenants/tenant-1/finance',
        method: 'GET',
        statusCode: 403,
        error: 'Forbidden',
      }),
    );
    expect(response.status).toHaveBeenCalledWith(403);
  });

  it('sends 500 errors to Sentry and logs them as errors', () => {
    const filter = new SentryExceptionFilter(sentryService, loggerService);
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const error = new InternalServerErrorException('DB exploded');
    const host = createHost(
      {
        id: 'req-3',
        tenantId: 'tenant-1',
        userId: 'user-1',
        routePath: '/finance',
        path: '/finance',
        method: 'POST',
      },
      response,
    );

    filter.catch(error, host);

    expect(sentryService.captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        requestId: 'req-3',
        tenantId: 'tenant-1',
        userId: 'user-1',
        route: '/finance',
        method: 'POST',
        statusCode: 500,
      }),
    );
    expect(loggerService.error).toHaveBeenCalledWith(
      '[req-3] POST /finance - 500',
      error,
      expect.objectContaining({
        requestId: 'req-3',
        tenantId: 'tenant-1',
        userId: 'user-1',
        route: '/finance',
        method: 'POST',
        statusCode: 500,
      }),
    );
    expect(response.status).toHaveBeenCalledWith(500);
  });

  it('preserves the structured business code and safe metadata for EXCHANGE_RATE_NOT_FOUND', () => {
    const filter = new SentryExceptionFilter(sentryService, loggerService);
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = createHost(
      {
        id: 'req-4',
        routePath: '/tenants/t-1/finance/incomes/i-1/record',
        path: '/tenants/t-1/finance/incomes/i-1/record',
        method: 'POST',
      },
      response,
    );

    filter.catch(
      new UnprocessableEntityException({
        code: 'EXCHANGE_RATE_NOT_FOUND',
        originalCurrency: 'USD',
        functionalCurrency: 'VES',
        conversionDate: '2026-08-09',
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(422);
    const body = response.json.mock.calls[0][0];
    expect(body.statusCode).toBe(422);
    expect(body.code).toBe('EXCHANGE_RATE_NOT_FOUND');
    expect(body.originalCurrency).toBe('USD');
    expect(body.functionalCurrency).toBe('VES');
    expect(body.conversionDate).toBe('2026-08-09');
    expect(body.requestId).toBe('req-4');
    expect(body.timestamp).toBeDefined();
    expect(JSON.stringify(body)).not.toContain('stack');
  });

  it('preserves the structured business code for INVALID_EXCHANGE_RATE', () => {
    const filter = new SentryExceptionFilter(sentryService, loggerService);
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = createHost(
      {
        id: 'req-5',
        routePath: '/tenants/t-1/finance/incomes/i-1/record',
        path: '/tenants/t-1/finance/incomes/i-1/record',
        method: 'POST',
      },
      response,
    );

    filter.catch(
      new UnprocessableEntityException({
        code: 'INVALID_EXCHANGE_RATE',
        baseCurrency: 'VES',
        quoteCurrency: 'USD',
        effectiveAt: '2026-08-08T00:00:00.000Z',
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(422);
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe('INVALID_EXCHANGE_RATE');
    expect(body.baseCurrency).toBe('VES');
    expect(body.quoteCurrency).toBe('USD');
    expect(body.effectiveAt).toBe('2026-08-08T00:00:00.000Z');
    expect(JSON.stringify(body)).not.toContain('stack');
  });

  it('keeps compatible shape for a plain-string HttpException', () => {
    const filter = new SentryExceptionFilter(sentryService, loggerService);
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = createHost(
      {
        id: 'req-6',
        routePath: '/finance',
        path: '/finance',
        method: 'GET',
      },
      response,
    );

    filter.catch(new UnauthorizedException('Sesión expirada'), host);

    expect(response.status).toHaveBeenCalledWith(401);
    const body = response.json.mock.calls[0][0];
    expect(body.statusCode).toBe(401);
    expect(body.message).toBe('Sesión expirada');
    expect(body.requestId).toBe('req-6');
    expect(body.timestamp).toBeDefined();
    expect(body.code).toBeUndefined();
  });

  it('does not expose stack or internals for unexpected errors', () => {
    const filter = new SentryExceptionFilter(sentryService, loggerService);
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = createHost(
      {
        id: 'req-7',
        routePath: '/finance',
        path: '/finance',
        method: 'POST',
      },
      response,
    );

    const boom = new Error('boom');
    boom.stack = 'at internal/path.js:1:1';
    filter.catch(boom, host);

    expect(response.status).toHaveBeenCalledWith(500);
    const body = response.json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(JSON.stringify(body)).not.toContain('boom');
    expect(JSON.stringify(body)).not.toContain('stack');
    expect(JSON.stringify(body)).not.toContain('internal/path.js');
  });

  it('does not expose Prisma internals for Prisma-style errors', () => {
    const filter = new SentryExceptionFilter(sentryService, loggerService);
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = createHost(
      {
        id: 'req-8',
        routePath: '/finance',
        path: '/finance',
        method: 'POST',
      },
      response,
    );

    const prismaError = new Error('PrismaClientKnownRequestError');
    (prismaError as Error & { code?: string; meta?: unknown }).code = 'P2002';
    (prismaError as Error & { meta?: unknown }).meta = {
      target: ['tenantId', 'code'],
      modelName: 'Expense',
    };
    filter.catch(prismaError, host);

    expect(response.status).toHaveBeenCalledWith(500);
    const body = response.json.mock.calls[0][0];
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('P2002');
    expect(bodyText).not.toContain('Expense');
    expect(bodyText).not.toContain('stack');
  });
});
