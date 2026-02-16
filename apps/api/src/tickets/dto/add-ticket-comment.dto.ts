import { IsString, Length } from 'class-validator';

export class AddTicketCommentDto {
  @IsString()
  @Length(1, 2000)
  body: string;
}
