import { IsUUID, IsString } from 'class-validator';

/**
 * Base parameter DTOs for common route patterns
 * These are used across all controllers to ensure type safety
 */

export class IdParamDto {
  @IsUUID()
  id!: string;
}

export class TenantParamDto {
  @IsUUID()
  tenantId!: string;
}

export class BuildingParamDto {
  @IsUUID()
  buildingId!: string;
}

export class UnitParamDto {
  @IsUUID()
  unitId!: string;
}

export class TenantBuildingParamDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  buildingId!: string;
}

export class BuildingChargeParamDto {
  @IsUUID()
  buildingId!: string;

  @IsUUID()
  chargeId!: string;
}

export class BuildingPaymentParamDto {
  @IsUUID()
  buildingId!: string;

  @IsUUID()
  paymentId!: string;
}

export class BuildingAllocationParamDto {
  @IsUUID()
  buildingId!: string;

  @IsUUID()
  allocationId!: string;
}

export class BuildingTicketParamDto {
  @IsUUID()
  buildingId!: string;

  @IsUUID()
  ticketId!: string;
}

export class BuildingUnitParamDto {
  @IsUUID()
  buildingId!: string;

  @IsUUID()
  unitId!: string;
}

export class BuildingDocumentParamDto {
  @IsUUID()
  buildingId!: string;

  @IsUUID()
  documentId!: string;
}

export class BuildingVendorParamDto {
  @IsUUID()
  buildingId!: string;

  @IsUUID()
  vendorId!: string;
}

export class BuildingCommunicationParamDto {
  @IsUUID()
  buildingId!: string;

  @IsUUID()
  communicationId!: string;
}

export class TenantIdMembershipIdParamDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  membershipId!: string;
}

export class TicketCommentParamDto {
  @IsUUID()
  ticketId!: string;

  @IsUUID()
  commentId!: string;
}

export class CommunicationRecipientParamDto {
  @IsUUID()
  communicationId!: string;

  @IsUUID()
  recipientId!: string;
}

export class InvitationTokenParamDto {
  @IsString()
  token!: string;
}
