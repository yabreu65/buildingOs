import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiNudge, AiNudgesService } from './ai-nudges.service';
import { resolveTenantId } from '../common/tenant-context/tenant-context.resolver';

@Controller('me/ai')
@UseGuards(JwtAuthGuard)
export class AiNudgesController {
  constructor(private readonly aiNudgesService: AiNudgesService) {}

  @Get('nudges')
  async getNudges(@Request() req: any): Promise<AiNudge[]> {
    const tenantId = resolveTenantId(req, {
      allowHeaderFallback: true,
      allowSingleMembershipFallback: true,
      requireMembership: true,
    });

    return this.aiNudgesService.getActiveNudges(req.user, tenantId);
  }

  @Post('nudges/:key/dismiss')
  async dismissNudge(
    @Request() req: any,
    @Param('key') key: AiNudge['key'],
  ) {
    const tenantId = resolveTenantId(req, {
      allowHeaderFallback: true,
      allowSingleMembershipFallback: true,
      requireMembership: true,
    });

    return this.aiNudgesService.dismissNudge(req.user, tenantId, key);
  }

  @Post('upgrade-request/recommended')
  async createRecommendedUpgradeRequest(
    @Request() req: any,
    @Body() body?: { tenantId?: string },
  ) {
    const requestedTenantId = this.normalizeTenantId(body?.tenantId);

    if (requestedTenantId) {
      req.tenantId = requestedTenantId;
    }

    const tenantId = resolveTenantId(req, {
      allowHeaderFallback: true,
      allowSingleMembershipFallback: true,
      requireMembership: true,
    });

    return this.aiNudgesService.createRecommendedUpgradeRequest(req.user, tenantId);
  }

  private normalizeTenantId(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const tenantId = value.trim();
    if (!tenantId) {
      throw new BadRequestException('tenantId invalido');
    }

    return tenantId;
  }
}
