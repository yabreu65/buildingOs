import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function createContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows when no roles are required', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext({}))).toBe(true);
  });

  it('allows when user.role matches required role', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['TENANT_ADMIN']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext({ role: 'tenant_admin' }))).toBe(true);
  });

  it('allows when user.roles contains required role', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['SUPER_ADMIN']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext({ roles: ['TENANT_ADMIN', 'super_admin'] }))).toBe(
      true,
    );
  });

  it('allows when isSuperAdmin is true and endpoint requires SUPER_ADMIN', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['SUPER_ADMIN']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext({ isSuperAdmin: true }))).toBe(true);
  });

  it('denies when user has no required roles', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['SUPER_ADMIN']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext({ roles: ['TENANT_ADMIN'] }))).toBe(false);
  });
});
