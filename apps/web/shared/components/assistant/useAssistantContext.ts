'use client';

import { useParams, usePathname } from 'next/navigation';
import { getSession } from '@/features/auth/session.storage';
import type { AssistantContext } from '../assistant';

interface UseAssistantContextOptions {
  moduleMap?: Record<string, string>;
}

/**
 * Hook para construir automáticamente el contexto del Assistant
 * desde el estado de la aplicación (URL, sesión, etc.)
 */
export function useAssistantContext(options: UseAssistantContextOptions = {}) {
  const { moduleMap = defaultModuleMap } = options;
  
  const params = useParams();
  const pathname = usePathname();
  
  // Get session synchronously from localStorage
  const session = typeof window !== 'undefined' ? getSession() : null;

  const tenantId = params.tenantId as string | undefined;
  const buildingId = params.buildingId as string | undefined;
  
  const userId = session?.user?.id || 'unknown';
  const role = session?.memberships?.[0]?.roles?.[0] || 'UNKNOWN';
  const permissions = session?.memberships?.[0]?.roles;
  
  const route = pathname || '/';
  
  const currentModule = inferCurrentModule(route, moduleMap);

  const context: AssistantContext = {
    appId: 'buildingos',
    tenantId: tenantId || session?.activeTenantId || 'unknown',
    userId,
    role,
    route,
    currentModule,
    permissions,
    unitOccupantRole: undefined,
  };

  return context;
}

const defaultModuleMap: Record<string, string> = {
  '/finance': 'charges',
  '/finanzas': 'charges',
  '/charges': 'charges',
  '/payments': 'payments',
  '/payments/review': 'payments',
  '/units': 'units',
  '/buildings': 'buildings',
  '/tickets': 'tickets',
  '/support': 'support',
  '/vendors': 'vendors',
  '/reports': 'reports',
  '/settings': 'settings',
  '/members': 'roles',
  '/dashboard': 'dashboard',
};

function inferCurrentModule(route: string, moduleMap: Record<string, string>): string | undefined {
  const normalizedRoute = route.toLowerCase();
  
  for (const [pattern, module] of Object.entries(moduleMap)) {
    if (normalizedRoute.includes(pattern.toLowerCase())) {
      return module;
    }
  }
  
  return undefined;
}