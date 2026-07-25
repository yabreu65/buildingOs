import { IsString, Length, IsOptional, IsInt, Min, IsEnum } from 'class-validator';

export enum DocumentUploadPurpose {
  GENERAL_DOCUMENT = 'GENERAL_DOCUMENT',
  PAYMENT_PROOF = 'PAYMENT_PROOF',
}

/**
 * Request to generate a presigned upload URL
 * Step 1 of 2-step upload process
 */
export class PresignUploadDto {
  @IsString()
  @Length(1, 255)
  originalName!: string; // Original filename for download

  @IsString()
  @Length(1, 100)
  mimeType!: string; // MIME type (e.g., "application/pdf")

  @IsOptional()
  @IsInt()
  @Min(1)
  size?: number; // Client-provided hint for early rejection

  @IsOptional()
  @IsEnum(DocumentUploadPurpose)
  purpose?: DocumentUploadPurpose;
}

/**
 * Response: Presigned URL for PUT upload to MinIO
 */
export class PresignedUrlResponse {
  url!: string; // Presigned URL (valid for ~24 hours)
  bucket!: string; // MinIO bucket name
  objectKey!: string; // Object key in bucket
  expiresAt!: Date; // Expiration timestamp
}
