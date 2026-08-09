import { ROLE_PERMISSIONS } from '@buildingos/permissions';

describe('multicurrency RBAC', () => {
  it.each(['TENANT_OWNER', 'TENANT_ADMIN'] as const)('allows %s to read and write', (role) => {
    expect(ROLE_PERMISSIONS[role]).toEqual(expect.arrayContaining(['finance.settings.read', 'finance.settings.write']));
  });

  it('allows OPERATOR to read but denies write', () => {
    expect(ROLE_PERMISSIONS.OPERATOR).toContain('finance.settings.read');
    expect(ROLE_PERMISSIONS.OPERATOR).not.toContain('finance.settings.write');
  });

  it('denies resident access', () => {
    expect(ROLE_PERMISSIONS.RESIDENT).not.toContain('finance.settings.read');
    expect(ROLE_PERMISSIONS.RESIDENT).not.toContain('finance.settings.write');
  });
});
