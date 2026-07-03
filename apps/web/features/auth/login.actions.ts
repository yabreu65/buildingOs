import { AuthSession, Role } from './auth.types';
import { setSession, clearAuth } from './session.storage';
import { apiLogout } from './auth.service';
import { clearAllImpersonationData } from '../impersonation/impersonation.storage';

export function loginAs(role: Role) {
  const session: AuthSession = {
    user: {
      id: 'u_1',
      email: 'demo@buildingos.com',
      name: 'Demo User',
    },
    memberships: [
      { tenantId: 't_1', roles: [role] },
      { tenantId: 't_2', roles: [role] },
    ],
    activeTenantId: 't_1',
  };
  clearAllImpersonationData();
  setSession(session);
  return session;
}

export async function logout() {
  try {
    await apiLogout();
  } catch {
    // Best-effort server logout; always clear local auth state.
  } finally {
    clearAllImpersonationData();
    clearAuth();
  }
}
