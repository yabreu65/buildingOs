import {
  IsString,
  IsEnum,
  IsOptional,
  Length,
} from 'class-validator';
import { DocumentCategory, DocumentVisibility } from '@prisma/client';

/**
 * Update Document metadata (title, category, visibility)
 * File/objectKey cannot be changed (immutable after upload)
 */
export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;

  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;

  @IsOptional()
  @IsEnum(DocumentVisibility)
  visibility?: DocumentVisibility;
}
