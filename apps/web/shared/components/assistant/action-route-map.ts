/**
 * Action Route Map
 * 
 * Mapping de actions del assistant a rutas del SaaS.
 * Centraliza la lógica de navegación para mantener el widget limpio.
 */

export type ActionKey = 
  | 'open-buildings'
  | 'open-units'
  | 'open-charges'
  | 'open-payments'
  | 'open-payments-review'
  | 'review-generated-charges'
  | 'publish-charges'
  | 'view-my-charges'
  | 'check-my-payment-status'
  | 'review-pending-payments'
  | 'view-payment-history'
  | 'view-pending-charges'
  | 'view-my-balance'
  | 'report-payment'
  | 'upload-payment-proof'
  | 'view-all-payments'
  | 'open-tickets'
  | 'create-ticket'
  | 'view-my-tickets'
  | 'review-open-tickets'
  | 'view-all-tickets'
  | 'open-communications'
  | 'create-communication'
  | 'view-all-communications'
  | 'view-my-inbox'
  | 'view-notices'
  | 'open-documents'
  | 'upload-document'
  | 'view-building-documents'
  | 'view-rules';

export type ActionPathResolver = (tenantId: string) => string;

export const ACTION_ROUTE_MAP: Record<string, ActionPathResolver> = {
  'open-buildings': (tenantId) => `/${tenantId}/buildings`,
  'open-units': (tenantId) => `/${tenantId}/units`,
  'open-charges': (tenantId) => `/${tenantId}/finanzas?tab=charges`,
  'open-payments': (tenantId) => `/${tenantId}/finanzas?tab=payments`,
  'open-payments-review': (tenantId) => `/${tenantId}/payments/review`,
  'review-generated-charges': (tenantId) => `/${tenantId}/finanzas?tab=charges`,
  'publish-charges': (tenantId) => `/${tenantId}/finanzas?tab=charges`,
  'view-my-charges': (tenantId) => `/${tenantId}/finanzas?tab=charges`,
  'check-my-payment-status': (tenantId) => `/${tenantId}/finanzas?tab=payments`,
  'review-pending-payments': (tenantId) => `/${tenantId}/payments/review`,
  // Payments actions
  'view-payment-history': (tenantId) => `/${tenantId}/finanzas?tab=payments`,
  'view-pending-charges': (tenantId) => `/${tenantId}/finanzas?tab=charges`,
  'view-my-balance': (tenantId) => `/${tenantId}/finanzas?tab=payments`,
  'report-payment': (tenantId) => `/${tenantId}/finanzas?tab=payments`,
  'upload-payment-proof': (tenantId) => `/${tenantId}/finanzas?tab=payments`,
  'view-all-payments': (tenantId) => `/${tenantId}/payments/review`,
  // Tickets actions
  'open-tickets': (tenantId) => `/${tenantId}/support`,
  'create-ticket': (tenantId) => `/${tenantId}/support/new`,
  'view-my-tickets': (tenantId) => `/${tenantId}/resident/tickets`,
  'review-open-tickets': (tenantId) => `/${tenantId}/support`,
  'view-all-tickets': (tenantId) => `/${tenantId}/support`,
  // Communications actions
  'open-communications': (tenantId) => `/${tenantId}/communications`,
  'create-communication': (tenantId) => `/${tenantId}/communications/new`,
  'view-all-communications': (tenantId) => `/${tenantId}/communications`,
  'view-my-inbox': (tenantId) => `/${tenantId}/resident/inbox`,
  'view-notices': (tenantId) => `/${tenantId}/communications?filter=notices`,
  // Documents actions
  'open-documents': (tenantId) => `/${tenantId}/documents`,
  'upload-document': (tenantId) => `/${tenantId}/documents/upload`,
  'view-building-documents': (tenantId) => `/${tenantId}/documents`,
  'view-rules': (tenantId) => `/${tenantId}/documents?category=rules`,
};

/**
 * Resuelve la ruta对应的 acción del assistant.
 * @returns La ruta si existe mapping, null si no hay mapping.
 */
export function getAssistantActionPath(actionKey: string, tenantId: string): string | null {
  const resolver = ACTION_ROUTE_MAP[actionKey];
  return resolver ? resolver(tenantId) : null;
}

/**
 * Verifica si una acción tiene mapping de ruta.
 */
export function isAssistantActionMapped(actionKey: string): boolean {
  return actionKey in ACTION_ROUTE_MAP;
}

/**
 * Obtiene todas las actions disponibles (para debugging/display).
 */
export function getAvailableActions(): Array<{ key: string; label: string }> {
  return [
    { key: 'open-buildings', label: 'Open Buildings' },
    { key: 'open-units', label: 'Open Units' },
    { key: 'open-charges', label: 'Open Charges' },
    { key: 'open-payments', label: 'Open Payments' },
    { key: 'open-payments-review', label: 'Open Payments Review' },
    { key: 'review-generated-charges', label: 'Review Generated Charges' },
    { key: 'publish-charges', label: 'Publish Charges' },
    { key: 'view-my-charges', label: 'View My Charges' },
    { key: 'check-my-payment-status', label: 'Check My Payment Status' },
    { key: 'review-pending-payments', label: 'Review Pending Payments' },
    { key: 'view-payment-history', label: 'View Payment History' },
    { key: 'view-pending-charges', label: 'View Pending Charges' },
    { key: 'view-my-balance', label: 'View My Balance' },
    { key: 'report-payment', label: 'Report Payment' },
    { key: 'upload-payment-proof', label: 'Upload Payment Proof' },
    { key: 'view-all-payments', label: 'View All Payments' },
    { key: 'open-tickets', label: 'Open Tickets' },
    { key: 'create-ticket', label: 'Create Ticket' },
    { key: 'view-my-tickets', label: 'View My Tickets' },
    { key: 'review-open-tickets', label: 'Review Open Tickets' },
    { key: 'view-all-tickets', label: 'View All Tickets' },
    { key: 'open-communications', label: 'Open Communications' },
    { key: 'create-communication', label: 'Create Communication' },
    { key: 'view-all-communications', label: 'View All Communications' },
    { key: 'view-my-inbox', label: 'View My Inbox' },
    { key: 'view-notices', label: 'View Notices' },
    { key: 'open-documents', label: 'Open Documents' },
    { key: 'upload-document', label: 'Upload Document' },
    { key: 'view-building-documents', label: 'View Building Documents' },
    { key: 'view-rules', label: 'View Building Rules' },
  ];
}