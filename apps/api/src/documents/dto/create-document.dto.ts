import {
  IsString,
  IsEnum,
  IsOptional,
  Length,
  ValidateNested,
  IsDefined,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DocumentCategory, DocumentVisibility } from '@prisma/client';

export class DocumentUploadFileDto {
  @IsString()
  @Length(1, 512)
  objectKey!: string;

  @IsString()
  @Length(1, 255)
  originalName!: string;

  @IsString()
  @Length(1, 100)
  mimeType!: string;

  @IsOptional()
  size?: number;

  @IsOptional()
  @IsString()
  checksum?: string;
}

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
  title!: string; // Display name

  @IsEnum(DocumentCategory)
  category!: DocumentCategory; // RULES, MINUTES, CONTRACT, BUDGET, INVOICE, RECEIPT, OTHER

  @IsEnum(DocumentVisibility)
  @IsOptional()
  visibility?: DocumentVisibility; // Default: TENANT_ADMINS

  @IsDefined()
  @ValidateNested()
  @Type(() => DocumentUploadFileDto)
  file!: DocumentUploadFileDto; // Uploaded file metadata from presign/upload flow

  // Scope fields
  @IsOptional()
  @IsString()
  buildingId?: string; // If building-scoped (can be null for tenant-wide)

  @IsOptional()
  @IsString()
  unitId?: string; // If unit-scoped (implies buildingId must also be set)
}
