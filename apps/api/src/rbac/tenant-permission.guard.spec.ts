import { ExecutionContext } from '@nestjs/common';
import type { Role } from '@buildingos/contracts';
import type { AuthenticatedRequest } from '../common/types/request.types';
import {
  REQUIRED_TENANT_PERMISSION_KEY,
  RequireTenantPermission,
  TenantPermissionGuard,
} from './tenant-permission.guard';

describe('TenantPermissionGuard', () => {
  class TestController {
    @RequireTenantPermission('members.manage')
    manageMembers(): void {}

    @RequireTenantPermission('buildings.write')
    writeBuildings(): void {}

    missingMetadata(): void {}
  }

  const guard = new TenantPermissionGuard();

  function buildRequest(roles: Role[], tenantId = 'tenant-a'): AuthenticatedRequest {
    return {
      params: { tenantId },
      tenantId,
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        tenantId,
        roles,
        memberships: [
          {
            id: 'membership-1',
            tenantId,
            roles,
          },
        ],
      },
    } as AuthenticatedRequest;
  }

  function buildContext(
    request: AuthenticatedRequest,
    methodName: keyof TestController,
  ): ExecutionContext {
    const handler = TestController.prototype[methodName];

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => handler,
      getClass: () => TestController,
    } as unknown as ExecutionContext;
  }

  it('stores readable permission metadata and applies the guard', () => {
    const handler = TestController.prototype.manageMembers;

    expect(
      Reflect.getMetadata(REQUIRED_TENANT_PERMISSION_KEY, handler),
    ).toBe('members.manage');
    expect(Reflect.getMetadata('__guards__', handler)).toContain(
      TenantPermissionGuard,
    );
  });

  it('allows tenant owners and tenant admins to manage members', () => {
    for (const role of ['TENANT_OWNER', 'TENANT_ADMIN'] satisfies Role[]) {
      expect(
        guard.canActivate(buildContext(buildRequest([role]), 'manageMembers')),
      ).toBe(true);
    }
  });

  it('denies residents and operators from managing members', () => {
    for (const role of ['RESIDENT', 'OPERATOR'] satisfies Role[]) {
      expect(() =>
        guard.canActivate(buildContext(buildRequest([role]), 'manageMembers')),
      ).toThrow('Missing required tenant permission: members.manage');
    }
  });

  it('allows tenant owners and tenant admins to write buildings', () => {
    for (const role of ['TENANT_OWNER', 'TENANT_ADMIN'] satisfies Role[]) {
      expect(
        guard.canActivate(buildContext(buildRequest([role]), 'writeBuildings')),
      ).toBe(true);
    }
  });

  it('denies residents and operators from writing buildings', () => {
    for (const role of ['RESIDENT', 'OPERATOR'] satisfies Role[]) {
      expect(() =>
        guard.canActivate(buildContext(buildRequest([role]), 'writeBuildings')),
      ).toThrow('Missing required tenant permission: buildings.write');
    }
  });

  it('denies stale tenant context that does not match the route tenant', () => {
    const request = buildRequest(['TENANT_OWNER'], 'tenant-a');
    request.tenantId = 'tenant-b';
    request.user.tenantId = 'tenant-b';

    expect(() =>
      guard.canActivate(buildContext(request, 'manageMembers')),
    ).toThrow('Tenant context does not match the request');
  });

  it('fails closed when request tenant context is missing even if user tenant matches', () => {
    const request = buildRequest(['TENANT_OWNER'], 'tenant-a');
    request.tenantId = undefined;

    expect(() =>
      guard.canActivate(buildContext(request, 'manageMembers')),
    ).toThrow('Tenant context does not match the request');
  });

  it('denies missing or empty roles', () => {
    const missingRolesRequest = buildRequest([], 'tenant-a');
    missingRolesRequest.user.roles = undefined;

    for (const request of [missingRolesRequest, buildRequest([], 'tenant-a')]) {
      expect(() =>
        guard.canActivate(buildContext(request, 'manageMembers')),
      ).toThrow('Missing required tenant permission: members.manage');
    }
  });

  it('allows super admins because shared permissions include tenant write grants', () => {
    expect(
      guard.canActivate(buildContext(buildRequest(['SUPER_ADMIN']), 'manageMembers')),
    ).toBe(true);
    expect(
      guard.canActivate(buildContext(buildRequest(['SUPER_ADMIN']), 'writeBuildings')),
    ).toBe(true);
  });

  it('fails closed when the guard is used without permission metadata', () => {
    expect(() =>
      guard.canActivate(
        buildContext(buildRequest(['TENANT_OWNER']), 'missingMetadata'),
      ),
    ).toThrow('Tenant permission requirement is missing');
  });
});
