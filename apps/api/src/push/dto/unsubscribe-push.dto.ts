import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class UnsubscribePushDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'endpoint should not be empty' })
  endpoint!: string;
}
