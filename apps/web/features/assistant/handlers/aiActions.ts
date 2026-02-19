/**
 * AI Actions Bridge
 *
 * Converts suggestedActions from AI Assistant into real navigation and UI prefills.
 * - Validates action type and payload
 * - Respects user permissions and context
 * - Sanitizes and limits payload sizes
 * - Routes to correct page with prefill params/state
 * - Never executes mutations automatically
 */

import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { SuggestedAction } from '../services/assistant.api';

export interface ActionContext {
  tenantId: string;
  buildingId?: string;
  unitId?: string;
  permissions: string[];
  router: AppRouterInstance;
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

/**
 * Sanitize string inputs for URL/form use
 */
function sanitize(input: string, maxLength: number = 120): string {
  if (!input) return '';
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[^\w\s\-áéíóúñ.,'!?()]/gi, ''); // Allow Spanish chars
}

/**
 * Check if user has permission for action
 */
function hasPermission(permissions: string[], requiredPermission: string): boolean {
  return permissions.includes(requiredPermission);
}

/**
 * Route to tickets list
 */
async function handleViewTickets(
  action: SuggestedAction,
  context: ActionContext,
): Promise<ActionResult> {
  const { buildingId } = action.payload || {};

  // Validate buildingId matches context
  if (!buildingId) {
    return {
      success: false,
      error: 'Building context required for tickets',
    };
  }

  if (context.buildingId && context.buildingId !== buildingId) {
    return {
      success: false,
      error: 'Building mismatch - cannot access',
    };
  }

  // Check permission
  if (!hasPermission(context.permissions, 'tickets.read')) {
    return {
      success: false,
      error: 'You do not have permission to view tickets',
    };
  }

  context.router.push(`/${context.tenantId}/buildings/${buildingId}/tickets`);
  return { success: true };
}

/**
 * Route to payments page
 */
async function handleViewPayments(
  action: SuggestedAction,
  context: ActionContext,
): Promise<ActionResult> {
  const { buildingId } = action.payload || {};

  if (!buildingId) {
    return {
      success: false,
      error: 'Building context required for payments',
    };
  }

  if (context.buildingId && context.buildingId !== buildingId) {
    return {
      success: false,
      error: 'Building mismatch - cannot access',
    };
  }

  // Check permission
  if (!hasPermission(context.permissions, 'payments.review')) {
    return {
      success: false,
      error: 'You do not have permission to view payments',
    };
  }

  context.router.push(`/${context.tenantId}/buildings/${buildingId}/payments`);
  return { success: true };
}

/**
 * Route to reports (tenant-wide or building-scoped)
 */
async function handleViewReports(
  action: SuggestedAction,
  context: ActionContext,
): Promise<ActionResult> {
  const { buildingId } = action.payload || {};

  // Check permission
  if (!hasPermission(context.permissions, 'reports.read')) {
    return {
      success: false,
      error: 'You do not have permission to view reports',
    };
  }

  // Route to building reports or tenant reports
  if (buildingId) {
    if (context.buildingId && context.buildingId !== buildingId) {
      return {
        success: false,
        error: 'Building mismatch - cannot access',
      };
    }
    context.router.push(`/${context.tenantId}/buildings/${buildingId}/reports`);
  } else {
    context.router.push(`/${context.tenantId}/reports`);
  }

  return { success: true };
}

/**
 * Route to documents search
 */
async function handleSearchDocs(
  action: SuggestedAction,
  context: ActionContext,
): Promise<ActionResult> {
  const { query, buildingId, unitId } = action.payload || {};

  if (!query) {
    return {
      success: false,
      error: 'Search query required',
    };
  }

  // Validate context matches if provided
  if (buildingId && context.buildingId && context.buildingId !== buildingId) {
    return {
      success: false,
      error: 'Building mismatch - cannot access',
    };
  }

  if (unitId && context.unitId && context.unitId !== unitId) {
    return {
      success: false,
      error: 'Unit mismatch - cannot access',
    };
  }

  // Check permission
  if (!hasPermission(context.permissions, 'documents.read')) {
    return {
      success: false,
      error: 'You do not have permission to view documents',
    };
  }

  const safeQuery = encodeURIComponent(sanitize(query, 200));

  if (buildingId && unitId) {
    context.router.push(
      `/${context.tenantId}/buildings/${buildingId}/units/${unitId}?tab=documents&q=${safeQuery}`,
    );
  } else if (buildingId) {
    context.router.push(
      `/${context.tenantId}/buildings/${buildingId}/documents?q=${safeQuery}`,
    );
  } else {
    context.router.push(`/${context.tenantId}/documents?q=${safeQuery}`);
  }

  return { success: true };
}

/**
 * Route to communication composer (opens modal with prefills)
 */
async function handleDraftCommunication(
  action: SuggestedAction,
  context: ActionContext,
): Promise<ActionResult> {
  const { buildingId, title = '', body = '' } = action.payload || {};

  if (!buildingId) {
    return {
      success: false,
      error: 'Building context required for communications',
    };
  }

  if (context.buildingId && context.buildingId !== buildingId) {
    return {
      success: false,
      error: 'Building mismatch - cannot access',
    };
  }

  // Check permission
  if (!hasPermission(context.permissions, 'communications.publish')) {
    return {
      success: false,
      error: 'You do not have permission to send communications',
    };
  }

  const safeTitle = sanitize(title, 120);
  const safeBody = sanitize(body, 2000);

  // Navigate with query params to signal modal open + prefills
  const params = new URLSearchParams();
  if (safeTitle) params.append('compose', '1');
  if (safeTitle) params.append('title', safeTitle);
  if (safeBody) params.append('body', safeBody);

  const queryString = params.toString();
  const url = `/${context.tenantId}/buildings/${buildingId}/communications${queryString ? `?${queryString}` : ''}`;

  context.router.push(url);
  return { success: true };
}

/**
 * Route to ticket creation (opens modal with prefills)
 */
async function handleCreateTicket(
  action: SuggestedAction,
  context: ActionContext,
): Promise<ActionResult> {
  const { buildingId, unitId, title = '', description = '' } = action.payload || {};

  if (!buildingId) {
    return {
      success: false,
      error: 'Building context required for tickets',
    };
  }

  if (context.buildingId && context.buildingId !== buildingId) {
    return {
      success: false,
      error: 'Building mismatch - cannot access',
    };
  }

  // If unitId provided, validate it belongs to the building
  if (unitId) {
    if (context.unitId && context.unitId !== unitId) {
      return {
        success: false,
        error: 'Unit mismatch - cannot access',
      };
    }
  }

  // Check permission
  if (!hasPermission(context.permissions, 'tickets.write')) {
    return {
      success: false,
      error: 'You do not have permission to create tickets',
    };
  }

  const safeTitle = sanitize(title, 120);
  const safeDescription = sanitize(description, 2000);

  // Navigate with query params to signal modal open + prefills
  const params = new URLSearchParams();
  if (safeTitle) params.append('newTicket', '1');
  if (safeTitle) params.append('title', safeTitle);
  if (safeDescription) params.append('description', safeDescription);
  if (unitId) params.append('unitId', unitId);

  const queryString = params.toString();

  if (unitId) {
    const url = `/${context.tenantId}/buildings/${buildingId}/units/${unitId}${queryString ? `?${queryString}` : ''}`;
    context.router.push(url);
  } else {
    const url = `/${context.tenantId}/buildings/${buildingId}/tickets${queryString ? `?${queryString}` : ''}`;
    context.router.push(url);
  }

  return { success: true };
}

/**
 * Main handler: Routes to appropriate action handler
 */
export async function handleSuggestedAction(
  action: SuggestedAction,
  context: ActionContext,
): Promise<ActionResult> {
  // Validate action exists
  if (!action || !action.type) {
    return {
      success: false,
      error: 'Invalid action',
    };
  }

  try {
    switch (action.type) {
      case 'VIEW_TICKETS':
        return await handleViewTickets(action, context);

      case 'VIEW_PAYMENTS':
        return await handleViewPayments(action, context);

      case 'VIEW_REPORTS':
        return await handleViewReports(action, context);

      case 'SEARCH_DOCS':
        return await handleSearchDocs(action, context);

      case 'DRAFT_COMMUNICATION':
        return await handleDraftCommunication(action, context);

      case 'CREATE_TICKET':
        return await handleCreateTicket(action, context);

      default:
        return {
          success: false,
          error: `Unknown action type: ${action.type}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      error: `Action failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Helper: Get action button label
 */
export function getActionLabel(type: string): string {
  const labels: Record<string, string> = {
    VIEW_TICKETS: 'View Tickets',
    VIEW_PAYMENTS: 'View Payments',
    VIEW_REPORTS: 'View Reports',
    SEARCH_DOCS: 'Search Documents',
    DRAFT_COMMUNICATION: 'Draft Message',
    CREATE_TICKET: 'Create Ticket',
  };
  return labels[type] || type;
}

/**
 * Helper: Check if action is allowed for user
 */
export function isActionAllowed(
  actionType: string,
  permissions: string[],
): boolean {
  const requirementsMap: Record<string, string[]> = {
    VIEW_TICKETS: ['tickets.read'],
    VIEW_PAYMENTS: ['payments.review'],
    VIEW_REPORTS: ['reports.read'],
    SEARCH_DOCS: ['documents.read'],
    DRAFT_COMMUNICATION: ['communications.publish'],
    CREATE_TICKET: ['tickets.write'],
  };

  const required = requirementsMap[actionType] || [];
  return required.every((perm) => permissions.includes(perm));
}
