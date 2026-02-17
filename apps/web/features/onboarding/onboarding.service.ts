import { ManualCompletionMap, TenantOnboardingState } from "./onboarding.types";

const DELAY_MS = 600;
const STORAGE_KEY_PREFIX = "bo_onboarding_manual_";

// Simula GET /api/tenants/:tenantId/onboarding
export async function fetchManualProgress(tenantId: string): Promise<TenantOnboardingState> {
  return new Promise((resolve) => {
    // Simulamos latencia de red
    setTimeout(() => {
      if (typeof window === "undefined") {
        resolve({
          tenantId,
          manualCompletions: {},
          lastUpdated: new Date().toISOString(),
        });
        return;
      }

      const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${tenantId}`);
      if (!raw) {
        resolve({
          tenantId,
          manualCompletions: {},
          lastUpdated: new Date().toISOString(),
        });
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch {
        // Fallback en caso de error de parseo
        resolve({
          tenantId,
          manualCompletions: {},
          lastUpdated: new Date().toISOString(),
        });
      }
    }, DELAY_MS);
  });
}

// Simula PUT /api/tenants/:tenantId/onboarding
export async function updateManualProgress(
  tenantId: string,
  completions: ManualCompletionMap
): Promise<TenantOnboardingState> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const newState: TenantOnboardingState = {
        tenantId,
        manualCompletions: completions,
        lastUpdated: new Date().toISOString(),
      };
      
      if (typeof window !== "undefined") {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${tenantId}`, JSON.stringify(newState));
      }
      
      resolve(newState);
    }, DELAY_MS);
  });
}
