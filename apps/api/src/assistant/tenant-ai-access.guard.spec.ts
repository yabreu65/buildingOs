import { BadRequestException, ForbiddenException, ExecutionContext } from '@nestjs/common';
import { TenantAiAccessGuard } from './tenant-ai-access.guard';

function buildContext(input: {
  params?: Record<string, string | undefined>;
  headers?: Record<string, unknown>;
  body?: { tenantId?: unknown };
  user?: {
    tenantId?: string;
    roles?: string[];
    memberships?: Array<{ tenantId: string; roles: string[] }>;
    effectiveMembership?: { tenantId: string; roles: string[] };
    isImpersonating?: boolean;
  };
}): ExecutionContext {
  const request = {
    params: input.params ?? {},
    headers: input.headers ?? {},
    body: input.body ?? {},
    user: input.user ?? {},
  } as never;

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

describe('TenantAiAccessGuard', () => {
  const guard = new TenantAiAccessGuard();

  it('allows tenant owners for route parameters', () => {
    const allowed = guard.canActivate(
      buildContext({
        params: { tenantId: 'tenant-1' },
        user: {
          memberships: [{ tenantId: 'tenant-1', roles: ['TENANT_OWNER'] }],
        },
      }),
    );

    expect(allowed).toBe(true);
  });

  it('allows operators from x-tenant-id headers', () => {
    const allowed = guard.canActivate(
      buildContext({
        headers: { 'x-tenant-id': 'tenant-1' },
        user: {
          memberships: [{ tenantId: 'tenant-1', roles: ['OPERATOR'] }],
        },
      }),
    );

    expect(allowed).toBe(true);
  });

  it('allows tenant admins from body tenantId', () => {
    const allowed = guard.canActivate(
      buildContext({
        body: { tenantId: 'tenant-1' },
        user: {
          memberships: [{ tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] }],
        },
      }),
    );

    expect(allowed).toBe(true);
  });

  it('denies residents even when the tenant matches', () => {
    expect(() =>
      guard.canActivate(
        buildContext({
          params: { tenantId: 'tenant-1' },
          user: {
            memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT'] }],
          },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('denies super-admin users without an authorized tenant membership', () => {
    expect(() =>
      guard.canActivate(
        buildContext({
          params: { tenantId: 'tenant-1' },
          user: {
            tenantId: 'tenant-1',
            roles: ['SUPER_ADMIN'],
            memberships: [],
          },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows impersonated tenant admins through the effective membership', () => {
    const allowed = guard.canActivate(
      buildContext({
        params: { tenantId: 'tenant-1' },
        user: {
          isImpersonating: true,
          memberships: [{ tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] }],
          effectiveMembership: { tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] },
        },
      }),
    );

    expect(allowed).toBe(true);
  });

  it('rejects missing tenant context', () => {
    expect(() =>
      guard.canActivate(
        buildContext({
          user: {},
        }),
      ),
    ).toThrow(BadRequestException);
  });
});
