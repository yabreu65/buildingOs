import { Transform } from 'class-transformer';
import { IsString, MinLength, IsNotEmpty } from 'class-validator';

export class ValidateInvitationQueryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  token!: string;
}
