import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Custom parameter decorator to extract tenantId from request params
 * and inject it into controller methods.
 *
 * Usage:
 * @Get()
 * findAll(@TenantParam() tenantId: string) { ... }
 */
export const TenantParam = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.params.tenantId;
  },
);
