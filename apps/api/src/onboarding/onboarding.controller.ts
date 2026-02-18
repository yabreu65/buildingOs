import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  TenantStepsResponseDto,
  BuildingStepsResponseDto,
} from './dtos/onboarding.dto';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    name: string;
  };
  tenantId?: string;
}

@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /onboarding/tenant
   * Get tenant-level onboarding steps for the active tenant
   *
   * @param req Request with user and tenantId from tenant context
   * @returns TenantStepsResponseDto with all tenant steps and completion status
   */
  @Get('tenant')
  async getTenantSteps(
    @Request() req: RequestWithUser,
  ): Promise<TenantStepsResponseDto> {
    const tenantId = req.tenantId;

    if (!tenantId) {
      throw new BadRequestException('Tenant context required (X-Tenant-Id header)');
    }

    // Verify tenant exists and user has access
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: req.user.id, tenantId } },
    });

    if (!membership) {
      throw new BadRequestException('User does not have access to this tenant');
    }

    const steps = await this.onboardingService.calculateTenantSteps(tenantId);
    const isDismissed = await this.onboardingService.isOnboardingDismissed(tenantId);

    const completedSteps = steps.filter((s) => s.status === 'DONE').length;
    const completionPercentage = Math.round((completedSteps / steps.length) * 100);

    return {
      tenantId,
      steps,
      isDismissed,
      completionPercentage,
    };
  }

  /**
   * GET /onboarding/buildings/:buildingId
   * Get building-level onboarding steps for a specific building
   *
   * @param buildingId - Building ID
   * @param req Request with user and tenantId context
   * @returns BuildingStepsResponseDto with all building steps and completion status
   */
  @Get('buildings/:buildingId')
  async getBuildingSteps(
    @Param('buildingId') buildingId: string,
    @Request() req: RequestWithUser,
  ): Promise<BuildingStepsResponseDto> {
    const tenantId = req.tenantId;

    if (!tenantId) {
      throw new BadRequestException('Tenant context required (X-Tenant-Id header)');
    }

    // Verify tenant exists and user has access
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: req.user.id, tenantId } },
    });

    if (!membership) {
      throw new BadRequestException('User does not have access to this tenant');
    }

    // Verify building belongs to tenant
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
    });

    if (!building || building.tenantId !== tenantId) {
      throw new BadRequestException('Building not found or does not belong to tenant');
    }

    const steps = await this.onboardingService.calculateBuildingSteps(buildingId);

    const completedSteps = steps.filter((s) => s.status === 'DONE').length;
    const completionPercentage = Math.round((completedSteps / steps.length) * 100);

    return {
      buildingId,
      tenantId,
      buildingName: building.name,
      steps,
      completionPercentage,
    };
  }

  /**
   * PATCH /onboarding/dismiss
   * Dismiss the onboarding checklist for the active tenant
   *
   * @param req Request with user and tenantId context
   */
  @Patch('dismiss')
  async dismissOnboarding(@Request() req: RequestWithUser): Promise<{ success: boolean }> {
    const tenantId = req.tenantId;

    if (!tenantId) {
      throw new BadRequestException('Tenant context required (X-Tenant-Id header)');
    }

    // Verify tenant exists and user has access
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: req.user.id, tenantId } },
    });

    if (!membership) {
      throw new BadRequestException('User does not have access to this tenant');
    }

    await this.onboardingService.dismissOnboarding(tenantId);

    return { success: true };
  }

  /**
   * PATCH /onboarding/restore
   * Restore the onboarding checklist visibility for the active tenant
   *
   * @param req Request with user and tenantId context
   */
  @Patch('restore')
  async restoreOnboarding(@Request() req: RequestWithUser): Promise<{ success: boolean }> {
    const tenantId = req.tenantId;

    if (!tenantId) {
      throw new BadRequestException('Tenant context required (X-Tenant-Id header)');
    }

    // Verify tenant exists and user has access
    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: req.user.id, tenantId } },
    });

    if (!membership) {
      throw new BadRequestException('User does not have access to this tenant');
    }

    await this.onboardingService.restoreOnboarding(tenantId);

    return { success: true };
  }
}
