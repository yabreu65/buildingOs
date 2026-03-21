import { DocumentVisibility } from '@prisma/client';

/**
 * File response DTO - safe subset of File entity
 */
export class FileResponseDto {
  id: string;
  tenantId: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  checksum: string;
  createdByMembershipId: string;
  createdAt: Date;
}

/**
 * User response DTO - safe subset for display
 */
export class UserResponseDto {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
}

/**
 * Membership response DTO - user + role context
 */
export class MembershipResponseDto {
  id: string;
  userId: string;
  user?: UserResponseDto;
}

/**
 * Document response DTO - main response for list/get/create/update
 */
export class DocumentResponseDto {
  id: string;
  tenantId: string;
  fileId: string;
  title: string;
  category: string;
  visibility: DocumentVisibility;
  buildingId?: string;
  unitId?: string;
  createdByMembershipId: string;
  createdByMembership?: MembershipResponseDto;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Document with file response DTO - includes file details
 */
export class DocumentWithFileResponseDto extends DocumentResponseDto {
  file?: FileResponseDto;
}

/**
 * Download URL response DTO
 */
export class DownloadUrlResponseDto {
  url: string;
  expiresAt: Date;
}
