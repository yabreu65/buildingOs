/**
 * Enums and literal types for domain models
 * These are used across the application for type safety
 */

// Charge
export type ChargeStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELED';

// Ticket
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

// Work Order
export type WorkOrderStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

// Quote
export type QuoteStatus = 'REQUESTED' | 'RECEIVED' | 'APPROVED' | 'REJECTED';

// i18n
export type Language = 'en' | 'es' | 'es-419';

// Communication
export type CommunicationChannel = 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
export type CommunicationType = 'ANNOUNCEMENT' | 'NOTIFICATION' | 'ALERT';

// Auth & RBAC
export type UserRole = 'SUPER_ADMIN' | 'TENANT_OWNER' | 'TENANT_ADMIN' | 'OPERATOR' | 'RESIDENT';

// API Response Types
export interface ApiResponseError {
  statusCode: number;
  message: string;
  error?: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiResponseError;
}
