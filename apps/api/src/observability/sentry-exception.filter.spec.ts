import {
  ArgumentsHost,
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
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
});
