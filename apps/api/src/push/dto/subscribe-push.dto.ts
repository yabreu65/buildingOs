import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class SubscribePushDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'endpoint should not be empty' })
  endpoint!: string;

  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  auth!: string;
}
