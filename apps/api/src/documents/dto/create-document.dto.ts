import {
  IsString,
  IsEnum,
  IsOptional,
  Length,
  IsInt,
  Min,
} from 'class-validator';
import { DocumentCategory, DocumentVisibility } from '@prisma/client';

/**
 * Create a Document after file upload
 *
 * Scope Rules (validated in service):
 * - Option A: buildingId only → building-scoped
 * - Option B: buildingId + unitId → unit-scoped (unitId must belong to building)
 * - Option C: both null → tenant-wide
 *
 * Step 2 of 2-step upload process (Step 1: PresignUploadDto)
 */
export class CreateDocumentDto {
  @IsString()
  @Length(1, 255)
  title: string; // Display name

  @IsEnum(DocumentCategory)
  category: DocumentCategory; // RULES, MINUTES, CONTRACT, BUDGET, INVOICE, RECEIPT, OTHER

  @IsEnum(DocumentVisibility)
  @IsOptional()
  visibility?: DocumentVisibility; // Default: TENANT_ADMINS

  @IsString()
  objectKey: string; // MinIO objectKey from presign response (validates file was uploaded)

  @IsInt()
  @Min(0)
  size: number; // File size in bytes (from upload response)

  @IsOptional()
  @IsString()
  checksum?: string; // SHA-256 hash from MinIO (for integrity check)

  // Scope fields
  @IsOptional()
  @IsString()
  buildingId?: string; // If building-scoped (can be null for tenant-wide)

  @IsOptional()
  @IsString()
  unitId?: string; // If unit-scoped (implies buildingId must also be set)
}
