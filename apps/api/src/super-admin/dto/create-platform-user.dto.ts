import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * DTO for creating a new platform (super admin) user.
 * Only the founder super admin can create new platform users.
 * All fields are required for account setup.
 */
export class CreatePlatformUserDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  password: string;
}
