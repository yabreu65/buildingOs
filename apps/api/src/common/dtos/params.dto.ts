import { IsString } from 'class-validator';

/**
 * Base parameter DTOs for common route patterns
 * These are used across all controllers to ensure type safety
 */

export class IdParamDto {
  @IsString()
  id!: string;
}

export class TenantParamDto {
  @IsString()
  tenantId!: string;
}

export class BuildingParamDto {
  @IsString()
  buildingId!: string;
}

export class UnitParamDto {
  @IsString()
  unitId!: string;
}

export class TenantBuildingParamDto {
  @IsString()
  tenantId!: string;

  @IsString()
  buildingId!: string;
}

export class BuildingChargeParamDto {
  @IsString()
  buildingId!: string;

  @IsString()
  chargeId!: string;
}

export class BuildingPaymentParamDto {
  @IsString()
  buildingId!: string;

  @IsString()
  paymentId!: string;
}

export class BuildingAllocationParamDto {
  @IsString()
  buildingId!: string;

  @IsString()
  allocationId!: string;
}

export class BuildingTicketParamDto {
  @IsString()
  buildingId!: string;

  @IsString()
  ticketId!: string;
}

export class BuildingUnitParamDto {
  @IsString()
  buildingId!: string;

  @IsString()
  unitId!: string;
}

export class BuildingDocumentParamDto {
  @IsString()
  buildingId!: string;

  @IsString()
  documentId!: string;
}

export class BuildingVendorParamDto {
  @IsString()
  buildingId!: string;

  @IsString()
  vendorId!: string;
}

export class BuildingCommunicationParamDto {
  @IsString()
  buildingId!: string;

  @IsString()
  communicationId!: string;
}

export class TenantIdMembershipIdParamDto {
  @IsString()
  tenantId!: string;

  @IsString()
  membershipId!: string;
}

export class TicketCommentParamDto {
  @IsString()
  ticketId!: string;

  @IsString()
  commentId!: string;
}

export class CommunicationRecipientParamDto {
  @IsString()
  communicationId!: string;

  @IsString()
  recipientId!: string;
}

export class InvitationTokenParamDto {
  @IsString()
  token!: string;
}
