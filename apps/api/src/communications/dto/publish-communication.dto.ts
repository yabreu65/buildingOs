import { IsBoolean, IsNotEmpty } from 'class-validator';

export class PublishCommunicationDto {
  @IsBoolean()
  @IsNotEmpty()
  sendWebPush!: boolean;
}
