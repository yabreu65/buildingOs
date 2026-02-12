import { IsEmail, IsNotEmpty, MinLength, IsOptional, IsEnum } from 'class-validator';

export enum TenantTypeEnum {
  ADMINISTRADORA = 'ADMINISTRADORA',
  EDIFICIO_AUTOGESTION = 'EDIFICIO_AUTOGESTION',
}

export class SignupDto {
  @IsEmail({}, { message: 'Email inválido' })
  email: string;

  @IsNotEmpty({ message: 'El nombre es requerido' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  name: string;

  @IsNotEmpty({ message: 'La contraseña es requerida' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  password: string;

  @IsOptional()
  @MinLength(2, { message: 'El nombre del tenant debe tener al menos 2 caracteres' })
  tenantName?: string;

  @IsOptional()
  @IsEnum(TenantTypeEnum, { message: 'Tipo de tenant inválido' })
  tenantType?: TenantTypeEnum;
}
