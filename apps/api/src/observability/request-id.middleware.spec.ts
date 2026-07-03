import { RequestIdMiddleware } from './request-id.middleware';
import type { LoggerService } from './logger.service';
import type { NextFunction, Request, Response } from 'express';

const mockedUuid = jest.fn();

jest.mock('uuid', () => ({
  v4: () => mockedUuid(),
}));

describe('RequestIdMiddleware', () => {
  let logger: Pick<LoggerService, 'logRequest'>;
  let middleware: RequestIdMiddleware;

  beforeEach(() => {
    logger = {
      logRequest: jest.fn(),
    };
    middleware = new RequestIdMiddleware(logger as LoggerService);
    mockedUuid.mockReturnValue('generated-request-id');
  });

  it('preserves an incoming X-Request-Id and echoes it in the response header', () => {
    const setHeader = jest.fn();
    const send = jest.fn(function (this: Response, data: unknown) {
      return data;
    });
    const req = {
      headers: { 'x-request-id': 'incoming-request-id' },
      method: 'GET',
      path: '/ready',
      ip: '127.0.0.1',
      get: jest.fn(() => 'jest-agent'),
      route: { path: '/ready' },
    } as unknown as Request;
    const res = {
      setHeader,
      send,
      statusCode: 200,
      getHeader: jest.fn(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(req as never, res, next);
    res.send('ok');

    expect(next).toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'incoming-request-id');
    expect(logger.logRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'incoming-request-id',
        method: 'GET',
        route: '/ready',
        statusCode: 200,
      }),
    );
  });

  it('generates a request id when the client does not send one', () => {
    const setHeader = jest.fn();
    const send = jest.fn(function (this: Response, data: unknown) {
      return data;
    });
    const req = {
      headers: {},
      method: 'GET',
      path: '/health',
      ip: '127.0.0.1',
      get: jest.fn(() => 'jest-agent'),
    } as unknown as Request;
    const res = {
      setHeader,
      send,
      statusCode: 200,
      getHeader: jest.fn(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(req as never, res, next);
    res.send('ok');

    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'generated-request-id');
    expect(logger.logRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'generated-request-id',
        method: 'GET',
        route: '/health',
      }),
    );
  });
});
