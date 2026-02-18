import { IsEmail, IsNotEmpty, MinLength, MaxLength, IsString } from 'class-validator';

/**
 * Login DTO with security validation
 * - Email: standard format validation
 * - Password: length limits to prevent abuse
 */
export class LoginDto {
  @IsEmail({}, { message: 'Email must be valid' })
  @IsString()
  @MaxLength(255)
  email: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  @MaxLength(255, { message: 'Password must not exceed 255 characters' })
  password: string;
}
