import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

function trimToNull(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function trimString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim();
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Transform(({ value }) => trimString(value), { toClassOnly: true })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => trimToNull(value), { toClassOnly: true })
  phone?: string | null;
}
