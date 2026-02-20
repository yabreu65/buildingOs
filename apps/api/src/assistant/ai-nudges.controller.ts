import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiNudge, AiNudgesService } from './ai-nudges.service';

@Controller('me/ai')
@UseGuards(JwtAuthGuard)
export class AiNudgesController {
  constructor(private readonly aiNudgesService: AiNudgesService) {}

  @Get('nudges')
  async getNudges(
    @Request() req: any,
    @Headers('x-tenant-id') tenantHeader?: string,
  ): Promise<AiNudge[]> {
    const tenantId = this.aiNudgesService.resolveTenantId(
      req.user,
      this.normalizeTenantId(tenantHeader),
    );

    return this.aiNudgesService.getActiveNudges(req.user, tenantId);
  }

  @Post('nudges/:key/dismiss')
  async dismissNudge(
    @Request() req: any,
    @Param('key') key: AiNudge['key'],
    @Headers('x-tenant-id') tenantHeader?: string,
  ) {
    const tenantId = this.aiNudgesService.resolveTenantId(
      req.user,
      this.normalizeTenantId(tenantHeader),
    );

    return this.aiNudgesService.dismissNudge(req.user, tenantId, key);
  }

  @Post('upgrade-request/recommended')
  async createRecommendedUpgradeRequest(
    @Request() req: any,
    @Headers('x-tenant-id') tenantHeader?: string,
    @Body() body?: { tenantId?: string },
  ) {
    const tenantId = this.aiNudgesService.resolveTenantId(
      req.user,
      this.normalizeTenantId(tenantHeader) ?? this.normalizeTenantId(body?.tenantId),
    );

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
