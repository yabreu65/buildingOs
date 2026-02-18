/**
 * Request ID Middleware
 * Generates/tracks unique requestId for each request
 * Enables end-to-end request tracing
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService, LogContext } from './logger.service';

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

  use(req: Request, res: Response, next: NextFunction) {
    // Generate or use existing requestId
    const requestId = req.headers['x-request-id'] as string || uuidv4();
    req.id = requestId;
    req.startTime = Date.now();

    // Extract tenant and user info if available
    req.tenantId = req.headers['x-tenant-id'] as string;
    if (req.user) {
      req.userId = (req.user as any).id;
    }

    // Add requestId to response header
    res.setHeader('X-Request-Id', requestId);

    // Log response when it finishes
    const originalSend = res.send;
    res.send = function (data: any) {
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
      this.logger.logRequest(context);

      // Call original send
      return originalSend.call(this, data);
    }.bind(this);

    next();
  }
}
