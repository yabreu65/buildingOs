/**
 * Barrel export for types
 */

// Enums
export * from './enums';

// Communication domain
export * from './communication';

// Props & UI
export * from './props';

// API Responses (explicit imports to avoid conflicts with enums.ts)
export { isApiError, isListResponse } from './api';

export type {
  // Generic wrappers
  ApiListResponse,
  ApiErrorResponse,
  ApiResponseWrapper,
  // Auth
  AuthLoginRequest,
  AuthLoginResponse,
  AuthSignupRequest,
  AuthSignupResponse,
  AuthMeResponse,
  // Building
  BuildingResponse,
  BuildingsListResponse,
  BuildingCreateRequest,
  BuildingUpdateRequest,
  // Unit
  UnitResponse,
  UnitsListResponse,
  UnitCreateRequest,
  UnitUpdateRequest,
  // Occupant
  OccupantResponse,
  OccupantsListResponse,
  OccupantAssignRequest,
  // Charge/Payment
  ChargeResponse,
  ChargesListResponse,
  ChargeCreateRequest,
  ChargeUpdateRequest,
  PaymentResponse,
  PaymentCreateRequest,
  // Ticket
  TicketResponse,
  TicketsListResponse,
  TicketCreateRequest,
  TicketUpdateRequest,
  TicketCommentResponse,
  TicketCommentCreateRequest,
  // Communication
  CommunicationApiResponse,
  CommunicationsListResponse,
  CommunicationCreateRequest,
  // Document
  DocumentResponse,
  DocumentsListResponse,
  PresignUrlResponse,
  DocumentUploadRequest,
  // Invitation
  InvitationResponse,
  InvitationsListResponse,
  InvitationCreateRequest,
  InvitationAcceptRequest,
  // Tenant
  TenantResponse,
  TenantsListResponse,
  TenantUpdateRequest,
  // Health
  HealthCheckResponse,
} from './api';
