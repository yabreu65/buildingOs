import { HttpException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ConfigService } from '../config/config.service';
import { RedisService } from '../redis/redis.service';
import { RateLimitMiddleware } from './rate-limit.middleware';

interface MiddlewareResult {
  readonly next: jest.Mock;
  readonly response: Response;
}

function createRequest(
  method: string,
  path: string,
  ip: string,
): Request {
  return {
    method,
    path,
    ip,
    headers: {},
    body: {},
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

function invoke(
  middleware: RateLimitMiddleware,
  request: Request,
): Promise<MiddlewareResult> {
  const response = { setHeader: jest.fn() } as unknown as Response;
  return new Promise((resolve) => {
    const next = jest.fn((error?: unknown) => resolve({ next, response: error ? response : response }));
    middleware.use(request, response, next as NextFunction);
  });
}

describe('RateLimitMiddleware', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    jest.useFakeTimers();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function createMiddleware(): RateLimitMiddleware {
    return new RateLimitMiddleware(
      { incrementCounter: jest.fn().mockResolvedValue(null) } as unknown as RedisService,
      { getValue: jest.fn().mockReturnValue('development') } as unknown as ConfigService,
    );
  }

  it('limits GET invitation validation before the controller can run without using the token query', async () => {
    const middleware = createMiddleware();
    const firstRequest = createRequest('GET', '/invitations/validate', '203.0.113.10');

    for (let index = 0; index < 10; index++) {
      const { next } = await invoke(middleware, firstRequest);
      expect(next).toHaveBeenCalledWith();
    }

    const { next, response } = await invoke(middleware, firstRequest);
    const error = next.mock.calls[0][0] as HttpException;
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(429);
    expect(JSON.stringify(error.getResponse())).not.toContain('token');
    expect(response.setHeader).toHaveBeenCalledWith('RateLimit-Limit', 10);

    const otherIp = await invoke(
      middleware,
      createRequest('GET', '/invitations/validate', '2001:db8::1'),
    );
    expect(otherIp.next).toHaveBeenCalledWith();
  });

  it('keeps POST acceptance protected and leaves unrelated GET routes unbounded', async () => {
    const middleware = createMiddleware();
    const acceptRequest = createRequest('POST', '/invitations/accept', '203.0.113.10');

    for (let index = 0; index < 10; index++) {
      const { next } = await invoke(middleware, acceptRequest);
      expect(next).toHaveBeenCalledWith();
    }

    const limitedAccept = await invoke(middleware, acceptRequest);
    expect((limitedAccept.next.mock.calls[0][0] as HttpException).getStatus()).toBe(429);

    const unrelatedGet = await invoke(
      middleware,
      createRequest('GET', '/health', '203.0.113.10'),
    );
    expect(unrelatedGet.next).toHaveBeenCalledWith();
    expect(unrelatedGet.response.setHeader).not.toHaveBeenCalled();
  });

  it('limits public lead submissions by IP, method, and path without email buckets', async () => {
    const middleware = createMiddleware();

    for (let index = 0; index < 10; index++) {
      const request = createRequest('POST', '/leads/public', '203.0.113.10');
      request.body = { email: `person-${index}@example.com` };
      const { next } = await invoke(middleware, request);
      expect(next).toHaveBeenCalledWith();
    }

    const duplicateRoute = createRequest('POST', '/leads/public', '203.0.113.10');
    duplicateRoute.body = { email: 'different@example.com' };
    const limited = await invoke(middleware, duplicateRoute);
    expect((limited.next.mock.calls[0][0] as HttpException).getStatus()).toBe(429);
  });
});
