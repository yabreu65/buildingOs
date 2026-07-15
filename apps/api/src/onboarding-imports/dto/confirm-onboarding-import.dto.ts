import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ConfirmOnboardingImportDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedPreviewVersion?: number;

  @IsOptional()
  @IsString()
  confirmationToken?: string;
}
