import {
  REQUIRED_TENANT_PERMISSION_KEY,
  TenantPermissionGuard,
} from './tenant-permission.guard';
import { BuildingsController } from '../buildings/buildings.controller';
import { InvitationsAdminController } from '../invitations/invitations.controller';
import { MembershipsController } from '../memberships/memberships.controller';
import { TenantMembersController } from '../tenant-members/tenant-members.controller';
import type { Permission } from './permissions';

interface GuardedMethodExpectation {
  readonly controller: object;
  readonly methodName: string;
  readonly permission: Permission;
}

describe('Tenant permission controller metadata', () => {
  const guardedMethods: readonly GuardedMethodExpectation[] = [
    {
      controller: MembershipsController.prototype,
      methodName: 'addRole',
      permission: 'members.manage',
    },
    {
      controller: MembershipsController.prototype,
      methodName: 'removeRole',
      permission: 'members.manage',
    },
    {
      controller: InvitationsAdminController.prototype,
      methodName: 'createInvitation',
      permission: 'members.manage',
    },
    {
      controller: InvitationsAdminController.prototype,
      methodName: 'revokeInvitation',
      permission: 'members.manage',
    },
    {
      controller: InvitationsAdminController.prototype,
      methodName: 'resendInvitation',
      permission: 'members.manage',
    },
    {
      controller: TenantMembersController.prototype,
      methodName: 'create',
      permission: 'members.manage',
    },
    {
      controller: TenantMembersController.prototype,
      methodName: 'update',
      permission: 'members.manage',
    },
    {
      controller: TenantMembersController.prototype,
      methodName: 'invite',
      permission: 'members.manage',
    },
    {
      controller: TenantMembersController.prototype,
      methodName: 'delete',
      permission: 'members.manage',
    },
    {
      controller: BuildingsController.prototype,
      methodName: 'create',
      permission: 'buildings.write',
    },
    {
      controller: BuildingsController.prototype,
      methodName: 'update',
      permission: 'buildings.write',
    },
    {
      controller: BuildingsController.prototype,
      methodName: 'remove',
      permission: 'buildings.write',
    },
  ];

  it.each(guardedMethods)(
    'requires $permission on $methodName',
    ({ controller, methodName, permission }) => {
      const method = getControllerMethod(controller, methodName);

      expect(
        Reflect.getMetadata(REQUIRED_TENANT_PERMISSION_KEY, method),
      ).toBe(permission);
      expect(Reflect.getMetadata('__guards__', method)).toContain(
        TenantPermissionGuard,
      );
    },
  );

  function getControllerMethod(
    controller: object,
    methodName: string,
  ): (...args: readonly unknown[]) => unknown {
    const method = Reflect.get(controller, methodName);
    if (typeof method !== 'function') {
      throw new Error(`${methodName} is not a controller method`);
    }

    return method as (...args: readonly unknown[]) => unknown;
  }
});
