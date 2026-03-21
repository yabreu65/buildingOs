/**
 * API response type definitions and contracts
 * Document expected response shapes for type safety
 *
 * NOTE: These types are for API layer documentation.
 * The enums.ts file contains ApiResponse and ApiResponseError used by the backend client.
 */

// ============================================================================
// Generic API Response Wrapper
// ============================================================================

export interface ApiListResponse<T = unknown> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiResponseWrapper<T = unknown> {
  data: T;
  status: number;
  message?: string;
}

export interface ApiErrorResponse {
  status: number;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Auth API
// ============================================================================

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export type AuthLoginResponse = ApiResponseWrapper<{
  token: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    roles: string[];
  };
  memberships: Array<{
    tenantId: string;
    roles: string[];
  }>;
}>;

export interface AuthSignupRequest {
  email: string;
  password: string;
  fullName: string;
  tenantName?: string;
}

export type AuthSignupResponse = AuthLoginResponse;

export type AuthMeResponse = ApiResponseWrapper<{
  user: {
    id: string;
    email: string;
    fullName: string;
    roles: string[];
  };
  memberships: Array<{
    tenantId: string;
    roles: string[];
  }>;
}>;

// ============================================================================
// Building API
// ============================================================================

export type BuildingResponse = ApiResponseWrapper<{
  id: string;
  tenantId: string;
  name: string;
  address?: string;
  units: number;
  occupants: number;
  createdAt: string;
  updatedAt: string;
}>;

export type BuildingsListResponse = ApiResponseWrapper<
  ApiListResponse<{
    id: string;
    tenantId: string;
    name: string;
    address?: string;
    units: number;
    occupants: number;
    createdAt: string;
  }>
>;

export interface BuildingCreateRequest {
  name: string;
  address?: string;
}

export interface BuildingUpdateRequest {
  name?: string;
  address?: string;
}

// ============================================================================
// Unit API
// ============================================================================

export type UnitResponse = ApiResponseWrapper<{
  id: string;
  label: string;
  buildingId: string;
  unitCode?: string;
  unitType: string;
  occupancyStatus: string;
  resident?: {
    id: string;
    name: string;
    email: string;
    phone?: string;
  };
  createdAt: string;
  updatedAt: string;
}>;

export type UnitsListResponse = ApiResponseWrapper<
  ApiListResponse<{
    id: string;
    label: string;
    buildingId: string;
    unitCode?: string;
    unitType: string;
    occupancyStatus: string;
    resident?: {
      id: string;
      name: string;
    };
    createdAt: string;
  }>
>;

export interface UnitCreateRequest {
  buildingId: string;
  label: string;
  unitCode?: string;
  unitType:
    | 'STUDIO'
    | 'ONE_BED'
    | 'TWO_BED'
    | 'THREE_PLUS_BED';
  occupancyStatus?: 'OCCUPIED' | 'VACANT' | 'MAINTENANCE';
}

export interface UnitUpdateRequest {
  label?: string;
  unitCode?: string;
  unitType?: string;
  occupancyStatus?: string;
}

// ============================================================================
// Occupant/Resident API
// ============================================================================

export type OccupantResponse = ApiResponseWrapper<{
  id: string;
  unitId: string;
  name: string;
  email: string;
  phone?: string;
  role?: string;
  isPrimary: boolean;
  assignedAt: string;
  endAt?: string;
}>;

export type OccupantsListResponse = ApiResponseWrapper<
  ApiListResponse<{
    id: string;
    unitId: string;
    name: string;
    email: string;
    isPrimary: boolean;
    assignedAt: string;
  }>
>;

export interface OccupantAssignRequest {
  unitId: string;
  name: string;
  email: string;
  phone?: string;
  isPrimary?: boolean;
}

// ============================================================================
// Charge/Payment API
// ============================================================================

export type ChargeResponse = ApiResponseWrapper<{
  id: string;
  tenantId: string;
  unitId: string;
  amount: number;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELED';
  dueDate: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ChargesListResponse = ApiResponseWrapper<
  ApiListResponse<{
    id: string;
    tenantId: string;
    unitId: string;
    amount: number;
    status: string;
    dueDate: string;
    createdAt: string;
  }>
>;

export interface ChargeCreateRequest {
  unitId: string;
  amount: number;
  dueDate: string;
  description?: string;
}

export interface ChargeUpdateRequest {
  amount?: number;
  status?: 'PENDING' | 'PARTIAL' | 'PAID' | 'CANCELED';
  dueDate?: string;
  description?: string;
}

export type PaymentResponse = ApiResponseWrapper<{
  id: string;
  chargeId: string;
  amount: number;
  method: string;
  reference?: string;
  createdAt: string;
}>;

export interface PaymentCreateRequest {
  chargeId: string;
  amount: number;
  method: string;
  reference?: string;
}

// ============================================================================
// Ticket API
// ============================================================================

export type TicketResponse = ApiResponseWrapper<{
  id: string;
  tenantId: string;
  unitId?: string;
  title: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  createdBy: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type TicketsListResponse = ApiResponseWrapper<
  ApiListResponse<{
    id: string;
    title: string;
    status: string;
    priority: string;
    createdAt: string;
  }>
>;

export interface TicketCreateRequest {
  title: string;
  description: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  unitId?: string;
}

export interface TicketUpdateRequest {
  title?: string;
  description?: string;
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  priority?: string;
  assignedTo?: string;
}

export type TicketCommentResponse = ApiResponseWrapper<{
  id: string;
  ticketId: string;
  body: string;
  createdBy: string;
  createdAt: string;
}>;

export interface TicketCommentCreateRequest {
  body: string;
}

// ============================================================================
// Communication API
// ============================================================================

export type CommunicationApiResponse = ApiResponseWrapper<{
  id: string;
  title: string;
  body: string;
  channel: 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
  type?: 'ANNOUNCEMENT' | 'NOTIFICATION' | 'ALERT';
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}>;

export type CommunicationsListResponse = ApiResponseWrapper<
  ApiListResponse<{
    id: string;
    title: string;
    channel: string;
    createdAt: string;
  }>
>;

export interface CommunicationCreateRequest {
  title: string;
  body: string;
  channel: 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
  type?: 'ANNOUNCEMENT' | 'NOTIFICATION' | 'ALERT';
  targets: Array<{
    targetType: 'TENANT' | 'BUILDING' | 'UNIT' | 'USER';
    targetId?: string;
  }>;
  scheduledFor?: string;
}

// ============================================================================
// Document/File API
// ============================================================================

export type DocumentResponse = ApiResponseWrapper<{
  id: string;
  tenantId: string;
  unitId?: string;
  name: string;
  type: string;
  size: number;
  url?: string;
  createdAt: string;
  uploadedBy?: string;
}>;

export type DocumentsListResponse = ApiResponseWrapper<
  ApiListResponse<{
    id: string;
    name: string;
    type: string;
    size: number;
    createdAt: string;
  }>
>;

export type PresignUrlResponse = ApiResponseWrapper<{
  url: string;
  expiresIn: number;
  objectKey: string;
  bucket: string;
}>;

export interface DocumentUploadRequest {
  name: string;
  type: string;
  unitId?: string;
}

// ============================================================================
// Invitation API
// ============================================================================

export type InvitationResponse = ApiResponseWrapper<{
  id: string;
  tenantId: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
}>;

export type InvitationsListResponse = ApiResponseWrapper<
  ApiListResponse<{
    id: string;
    email: string;
    role: string;
    expiresAt: string;
    status: 'PENDING' | 'ACCEPTED' | 'EXPIRED';
  }>
>;

export interface InvitationCreateRequest {
  email: string;
  role: string;
}

export interface InvitationAcceptRequest {
  token: string;
  password?: string;
}

// ============================================================================
// Tenant API
// ============================================================================

export type TenantResponse = ApiResponseWrapper<{
  id: string;
  name: string;
  plan: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  branding?: {
    logo?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };
  createdAt: string;
  updatedAt: string;
}>;

export type TenantsListResponse = ApiResponseWrapper<
  ApiListResponse<{
    id: string;
    name: string;
    plan: string;
    createdAt: string;
  }>
>;

export interface TenantUpdateRequest {
  name?: string;
  plan?: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  branding?: {
    logo?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };
}

// ============================================================================
// Health & Status API
// ============================================================================

export type HealthCheckResponse = ApiResponseWrapper<{
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  checks?: {
    database?: 'ok' | 'error';
    storage?: 'ok' | 'error';
    email?: 'ok' | 'error';
  };
}>;

// ============================================================================
// Helper Functions
// ============================================================================

export function isApiError(error: unknown): error is ApiErrorResponse {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'message' in error &&
    typeof (error as Record<string, unknown>).status === 'number' &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

export function isListResponse<T>(
  value: unknown
): value is ApiListResponse<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    'total' in value &&
    'page' in value &&
    'pageSize' in value &&
    Array.isArray((value as Record<string, unknown>).items)
  );
}
