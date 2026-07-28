import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/request.types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileResponse, ProfileService } from './profile.service';

@Controller('me/profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  getProfile(@Req() req: AuthenticatedRequest): Promise<ProfileResponse> {
    return this.profileService.getMyProfile(req);
  }

  @Patch()
  updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    return this.profileService.updateMyProfile(req, dto);
  }
}
