// Auth types
export type { AuthUser, AuthSession, Role, Membership, LoginResponse } from './auth.types';

// Auth services
export { apiLogin, apiSignup, apiMe } from './auth.service';
export type { LoginPayload, SignupPayload } from './auth.service';

// Auth hooks
export { useLogin, useSignup, useLogout } from './auth.hooks';
export { useAuth } from './useAuth';
export { useAuthSession, useHasRole, useIsSuperAdmin, useActiveTenantId } from './useAuthSession';

// Session storage
export {
  getSession,
  setSession,
  clearAuth,
  getLastTenant,
  setLastTenant,
  getLastPortal,
  setLastPortal,
  clearLastPortal,
} from './session.storage';

// Bootstrap
export { AuthBootstrap } from './AuthBootstrap';

// Landing route resolution
export { resolveActiveTenantId, resolveAuthLandingRoute, resolvePortalFromPathname } from './landing-route';
