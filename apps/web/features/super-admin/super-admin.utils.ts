/**
 * Utilidades para SUPER_ADMIN Dashboard
 */

import type { Tenant } from './super-admin.types';
import { PLAN_LABELS, TENANT_TYPE_LABELS, TENANT_STATUS_LABELS } from './tenants.storage';

/**
 * Obtiene etiqueta amigable para un plan
 */
export function getPlanLabel(plan: string): string {
  return PLAN_LABELS[plan] || plan;
}

/**
 * Obtiene etiqueta amigable para tipo de tenant
 */
export function getTenantTypeLabel(type: string): string {
  return TENANT_TYPE_LABELS[type] || type;
}

/**
 * Obtiene etiqueta amigable para status de tenant
 */
export function getTenantStatusLabel(status: string): string {
  return TENANT_STATUS_LABELS[status] || status;
}

/**
 * Obtiene clase CSS para badge de status
 */
export function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-800';
    case 'TRIAL':
      return 'bg-blue-100 text-blue-800';
    case 'SUSPENDED':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

/**
 * Formatea fecha para mostrar
 */
export function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return dateString;
  }
}

/**
 * Obtiene descripción del plan con límites
 */
export function getPlanDescription(plan: string): string {
  switch (plan) {
    case 'FREE':
      return '1 edificio, 10 unidades, 20 usuarios';
    case 'BASIC':
      return '5 edificios, 50 unidades, 100 usuarios';
    case 'PRO':
      return '20 edificios, 500 unidades, 500 usuarios';
    case 'ENTERPRISE':
      return 'Ilimitado, soporte personalizado';
    default:
      return '';
  }
}

/**
 * Valida nombre de tenant
 */
export function validateTenantName(name: string): string | null {
  if (!name || name.length < 2) {
    return 'El nombre debe tener al menos 2 caracteres';
  }
  if (name.length > 100) {
    return 'El nombre no puede exceder 100 caracteres';
  }
  return null;
}

/**
 * Valida email
 */
export function validateEmail(email: string): string | null {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return 'Email inválido';
  }
  return null;
}

/**
 * Calcula porcentaje de uso de un recurso
 */
export function getUsagePercentage(used: number, limit: number): number {
  if (limit === 0) return 0;
  return Math.round((used / limit) * 100);
}

/**
 * Determina si un tenant está cerca del límite
 */
export function isNearLimit(used: number, limit: number, threshold = 0.8): boolean {
  return used / limit >= threshold;
}

/**
 * Ordena tenants por campo
 */
export function sortTenants(
  tenants: Tenant[],
  field: 'name' | 'createdAt' | 'status' | 'plan',
  order: 'asc' | 'desc' = 'asc'
): Tenant[] {
  const sorted = [...tenants].sort((a, b) => {
    let aVal: string | number = '';
    let bVal: string | number = '';

    switch (field) {
      case 'name':
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
        break;
      case 'createdAt':
        aVal = new Date(a.createdAt).getTime();
        bVal = new Date(b.createdAt).getTime();
        break;
      case 'status':
        aVal = a.status;
        bVal = b.status;
        break;
      case 'plan':
        aVal = a.plan;
        bVal = b.plan;
        break;
    }

    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });

  return sorted;
}

/**
 * Obtiene resumen de tenant para mostrar
 */
export function getTenantSummary(tenant: Tenant): {
  typeLabel: string;
  statusLabel: string;
  planLabel: string;
  createdDate: string;
} {
  return {
    typeLabel: getTenantTypeLabel(tenant.type),
    statusLabel: getTenantStatusLabel(tenant.status),
    planLabel: getPlanLabel(tenant.plan),
    createdDate: formatDate(tenant.createdAt),
  };
}
