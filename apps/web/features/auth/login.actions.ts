import { AuthSession, Role } from "./auth.types";
import { setSession, clearAuth } from "./session.storage";

export function loginAs(role: Role) {
  const session: AuthSession = {
    user: {
      id: "u_1",
      email: "demo@buildingos.com",
      name: "Demo User",
    },
    memberships: [
      { tenantId: "t_1", roles: [role] },
      { tenantId: "t_2", roles: [role] },
    ],
    activeTenantId: "t_1",
  };
  setSession(session);
  return session;
}

export function logout() {
  clearAuth();
}
