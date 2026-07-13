import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { resolveTenantMembershipContext } from './request-context';
import type { AuthenticatedRequest } from './types/request.types';

function buildRequest(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    tenantId: 'tenant-legacy',
    user: {
      id: 'user-1',
      email: 'user@example.com',
      tenantId: 'tenant-legacy',
      membershipId: 'member-legacy',
      roles: ['TENANT_ADMIN'],
      effectiveMembership: {
        id: 'member-effective',
        tenantId: 'tenant-legacy',
        roles: ['TENANT_ADMIN'],
      },
      memberships: [],
    },
    ...overrides,
  } as AuthenticatedRequest;
}

describe('resolveTenantMembershipContext', () => {
  it('uses effectiveMembership when tenant matches', () => {
    const context = resolveTenantMembershipContext(buildRequest());

    expect(context).toEqual({
      tenantId: 'tenant-legacy',
      membershipId: 'member-effective',
      roles: ['TENANT_ADMIN'],
    });
  });

  it('rejects mismatched effectiveMembership tenantId', () => {
    expect(() =>
      resolveTenantMembershipContext(
        buildRequest({
          tenantId: 'tenant-a',
          user: {
            id: 'user-1',
            email: 'user@example.com',
            tenantId: 'tenant-a',
            membershipId: 'member-legacy',
            roles: ['TENANT_ADMIN'],
            effectiveMembership: {
              id: 'member-effective',
              tenantId: 'tenant-b',
              roles: ['TENANT_ADMIN'],
            },
            memberships: [],
          },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('falls back to the legacy membership context when effectiveMembership is absent', () => {
    const context = resolveTenantMembershipContext(
      buildRequest({
        user: {
          id: 'user-1',
          email: 'user@example.com',
          tenantId: 'tenant-legacy',
          membershipId: 'member-legacy',
          roles: ['TENANT_ADMIN'],
          memberships: [],
        },
      }),
    );

    expect(context).toEqual({
      tenantId: 'tenant-legacy',
      membershipId: 'member-legacy',
      roles: ['TENANT_ADMIN'],
    });
  });

  it('rejects missing tenantId', () => {
    expect(() =>
      resolveTenantMembershipContext(
        buildRequest({
          tenantId: undefined,
          user: {
            id: 'user-1',
            email: 'user@example.com',
            roles: ['TENANT_ADMIN'],
            memberships: [],
          },
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects missing membershipId when no effectiveMembership is available', () => {
    expect(() =>
      resolveTenantMembershipContext(
        buildRequest({
          user: {
            id: 'user-1',
            email: 'user@example.com',
            tenantId: 'tenant-legacy',
            roles: ['TENANT_ADMIN'],
            memberships: [],
          },
        }),
      ),
    ).toThrow(BadRequestException);
  });
});
