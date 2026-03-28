import { IsString, IsIn } from 'class-validator';

export class CreateOccupantDto {
  @IsString()
  memberId!: string;

  @IsIn(['OWNER', 'RESIDENT'])
  role!: 'OWNER' | 'RESIDENT';
}
