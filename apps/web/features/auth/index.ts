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
  getToken,
  setToken,
  clearAuth,
  getLastTenant,
  setLastTenant,
} from './session.storage';

// Bootstrap
export { default as AuthBootstrap } from './AuthBootstrap';
