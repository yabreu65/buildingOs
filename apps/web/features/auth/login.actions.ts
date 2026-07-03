import { clearAuth } from './session.storage';
import { apiLogout } from './auth.service';
import { clearAllImpersonationData } from '../impersonation/impersonation.storage';

export async function logout() {
  try {
    await apiLogout();
  } catch (error) {
    console.warn('[auth] Logout request failed; clearing local session anyway.', error);
  } finally {
    clearAllImpersonationData();
    clearAuth();
  }
}
