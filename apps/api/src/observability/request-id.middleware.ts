/**
 * Request ID Middleware
 * Generates/tracks unique requestId for each request
 * Enables end-to-end request tracing
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import type { AuthenticatedUser } from '../common/types/request.types';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService, LogContext } from './logger.service';

type ResponseSendArg = Parameters<Response['send']>[0];

interface RequestWithOptionalUser extends Request {
  user?: AuthenticatedUser;
}

declare global {
  namespace Express {
    interface Request {
      id: string;
      tenantId?: string;
      userId?: string;
      startTime?: number;
    }
  }
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private logger: LoggerService) {}

  use(req: RequestWithOptionalUser, res: Response, next: NextFunction) {
    // Generate or use existing requestId
    const requestId = req.headers['x-request-id'] as string || uuidv4();
    req.id = requestId;
    req.startTime = Date.now();

    // Extract tenant and user info if available
    req.tenantId = req.headers['x-tenant-id'] as string;
    if (req.user) {
      req.userId = req.user.id;
    }

    // Add requestId to response header
    res.setHeader('X-Request-Id', requestId);

    // Log response when it finishes
    const originalSend = res.send;
    const logger = this.logger;
    res.send = function (data: ResponseSendArg) {
      const durationMs = Date.now() - req.startTime!;
      const context: LogContext = {
        requestId,
        tenantId: req.tenantId,
        userId: req.userId,
        method: req.method,
        route: req.route?.path || req.path,
        statusCode: res.statusCode,
        durationMs,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      };

      // Log the request
      logger.logRequest(context);

      // Call original send - 'this' must be res (the response object)
      return originalSend.call(res, data);
    };

    next();
  }
}
