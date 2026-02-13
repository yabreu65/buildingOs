import { IsString, IsIn } from 'class-validator';

export class CreateOccupantDto {
  @IsString()
  userId: string;

  @IsIn(['OWNER', 'RESIDENT'])
  role: 'OWNER' | 'RESIDENT';
}
