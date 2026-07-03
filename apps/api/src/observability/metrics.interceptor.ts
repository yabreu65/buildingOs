import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import { MetricsService } from './metrics.service';
import type { Request, Response } from 'express';

type ObservedRequest = Request & {
  route?: {
    path?: string;
  };
};

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ObservedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(
      finalize(() => {
        const route = this.resolveRoute(request);
        const durationMs = Date.now() - startedAt;

        this.metricsService.recordHttpRequest({
          method: request.method,
          route,
          statusCode: response.statusCode,
          durationMs,
        });
      }),
    );
  }

  private resolveRoute(request: ObservedRequest): string {
    if (request.route?.path) {
      return `${request.method} ${request.route.path}`;
    }

    const path = request.originalUrl?.split('?')[0] ?? request.path;
    return `${request.method} ${path}`;
  }
}
