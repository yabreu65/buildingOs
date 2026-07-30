import {
  hasAdministrativePortalAccess,
  normalizePortalContextHeader,
  resolveNotificationPortalContext,
} from './portal-context';

describe('normalizePortalContextHeader', () => {
  it('returns resident for resident', () => {
    expect(normalizePortalContextHeader('resident')).toBe('resident');
  });

  it('returns admin for admin', () => {
    expect(normalizePortalContextHeader('admin')).toBe('admin');
  });

  it('returns undefined for undefined', () => {
    expect(normalizePortalContextHeader(undefined)).toBeUndefined();
  });

  it('returns undefined for invalid values', () => {
    expect(normalizePortalContextHeader('resident ')).toBeUndefined();
    expect(normalizePortalContextHeader('ADMIN')).toBeUndefined();
    expect(normalizePortalContextHeader('')).toBeUndefined();
  });
});

describe('resolveNotificationPortalContext', () => {
  it('returns resident for a pure resident without header', () => {
    expect(resolveNotificationPortalContext(['RESIDENT'])).toBe('resident');
  });

  it('returns resident for a pure resident with a falsified admin header', () => {
    expect(resolveNotificationPortalContext(['RESIDENT'], 'admin')).toBe('resident');
  });

  it('returns admin for a pure tenant admin with a falsified resident header', () => {
    expect(resolveNotificationPortalContext(['TENANT_ADMIN'], 'resident')).toBe('admin');
  });

  it('returns admin for a pure super admin with a falsified resident header', () => {
    expect(resolveNotificationPortalContext(['SUPER_ADMIN'], 'resident')).toBe('admin');
  });

  it('returns resident for resident plus tenant admin when header is resident', () => {
    expect(resolveNotificationPortalContext(['RESIDENT', 'TENANT_ADMIN'], 'resident')).toBe('resident');
  });

  it('returns admin for resident plus tenant admin without header', () => {
    expect(resolveNotificationPortalContext(['RESIDENT', 'TENANT_ADMIN'])).toBe('admin');
  });

  it('returns resident for resident plus operator when header is resident', () => {
    expect(resolveNotificationPortalContext(['RESIDENT', 'OPERATOR'], 'resident')).toBe('resident');
  });

  it('returns admin for resident plus tenant owner when header is admin', () => {
    expect(resolveNotificationPortalContext(['RESIDENT', 'TENANT_OWNER'], 'admin')).toBe('admin');
  });

  it('returns resident for resident plus super admin when header is resident', () => {
    expect(resolveNotificationPortalContext(['RESIDENT', 'SUPER_ADMIN'], 'resident')).toBe('resident');
  });

  it('returns admin for resident plus super admin without header', () => {
    expect(resolveNotificationPortalContext(['RESIDENT', 'SUPER_ADMIN'])).toBe('admin');
  });
});

describe('hasAdministrativePortalAccess', () => {
  it('returns false for a pure resident without header', () => {
    expect(hasAdministrativePortalAccess(['RESIDENT'])).toBe(false);
  });

  it('returns false for a pure resident with an admin header', () => {
    expect(hasAdministrativePortalAccess(['RESIDENT'], 'admin')).toBe(false);
  });

  it('returns false for a pure resident with a resident header', () => {
    expect(hasAdministrativePortalAccess(['RESIDENT'], 'resident')).toBe(false);
  });

  it('returns false for a pure resident with an invalid header', () => {
    expect(hasAdministrativePortalAccess(['RESIDENT'], 'admin ')).toBe(false);
  });

  it('returns true for a pure tenant admin without a header', () => {
    expect(hasAdministrativePortalAccess(['TENANT_ADMIN'])).toBe(true);
  });

  it('returns true for a pure tenant admin with an admin header', () => {
    expect(hasAdministrativePortalAccess(['TENANT_ADMIN'], 'admin')).toBe(true);
  });

  it('returns false for a pure tenant admin with a resident header', () => {
    expect(hasAdministrativePortalAccess(['TENANT_ADMIN'], 'resident')).toBe(false);
  });

  it('returns false for a pure tenant admin with an invalid header', () => {
    expect(hasAdministrativePortalAccess(['TENANT_ADMIN'], 'admin ')).toBe(false);
  });

  it('returns true for a pure super admin without a header', () => {
    expect(hasAdministrativePortalAccess(['SUPER_ADMIN'])).toBe(true);
  });

  it('returns false for a pure super admin with a resident header', () => {
    expect(hasAdministrativePortalAccess(['SUPER_ADMIN'], 'resident')).toBe(false);
  });

  it('returns true for a resident plus tenant admin without a header', () => {
    expect(hasAdministrativePortalAccess(['RESIDENT', 'TENANT_ADMIN'])).toBe(true);
  });

  it('returns true for a resident plus tenant admin with an admin header', () => {
    expect(hasAdministrativePortalAccess(['RESIDENT', 'TENANT_ADMIN'], 'admin')).toBe(true);
  });

  it('returns false for a resident plus tenant admin with a resident header', () => {
    expect(hasAdministrativePortalAccess(['RESIDENT', 'TENANT_ADMIN'], 'resident')).toBe(false);
  });

  it('returns false for a resident plus tenant admin with an invalid header', () => {
    expect(hasAdministrativePortalAccess(['RESIDENT', 'TENANT_ADMIN'], 'admin ')).toBe(false);
  });

  it('returns true for a resident plus operator with an admin header', () => {
    expect(hasAdministrativePortalAccess(['RESIDENT', 'OPERATOR'], 'admin')).toBe(true);
  });

  it('returns true for a resident plus tenant owner with an admin header', () => {
    expect(hasAdministrativePortalAccess(['RESIDENT', 'TENANT_OWNER'], 'admin')).toBe(true);
  });

  it('returns true for a resident plus super admin without a header', () => {
    expect(hasAdministrativePortalAccess(['RESIDENT', 'SUPER_ADMIN'])).toBe(true);
  });

  it('returns false for empty roles', () => {
    expect(hasAdministrativePortalAccess([])).toBe(false);
  });

  it('returns false for unknown roles', () => {
    expect(hasAdministrativePortalAccess(['MANAGER'])).toBe(false);
  });
});
