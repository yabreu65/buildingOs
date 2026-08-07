import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';

/**
 * Interceptor that validates boolean fields in the raw request body BEFORE
 * the global ValidationPipe runs.
 *
 * Why interceptor and not pipe? The global ValidationPipe uses
 * `enableImplicitConversion: true`, which causes class-transformer to convert
 * `0` → `false`, `"true"` → `true`, etc. BEFORE class-validator decorators
 * execute. A handler-level `@UsePipes()` runs AFTER global pipes, so by the
 * time a custom pipe sees the value, it's already been converted.
 *
 * Interceptors execute before pipes in the NestJS lifecycle:
 * Middleware → Guards → Interceptors → Pipes → Handler
 */
@Injectable()
export class StrictBooleanInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const body = req.body as Record<string, unknown> | undefined;

    if (body && 'isActive' in body && typeof body.isActive !== 'boolean') {
      throw new BadRequestException({
        statusCode: 400,
        message: ['isActive must be a boolean (true or false)'],
        error: 'Bad Request',
      });
    }

    return next.handle();
  }
}
