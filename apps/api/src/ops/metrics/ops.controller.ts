import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { resolveTenantId } from '../../common/tenant-context/tenant-context.resolver';
import { AuthenticatedRequest } from '../../common/types/request.types';
import { OpsMetricsQueueService } from './ops-metrics.queue';
import { OpsService } from './ops.service';
import { OpsActorContext } from './ops.types';

@Controller('ops')
@UseGuards(JwtAuthGuard)
export class OpsController {
  constructor(
    private readonly opsService: OpsService,
    private readonly opsMetricsQueue: OpsMetricsQueueService,
  ) {}

  private extractActor(req: AuthenticatedRequest): OpsActorContext {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authenticated user required');

    const directRoles = req.user?.roles ?? [];
    if (directRoles.includes('SUPER_ADMIN')) {
      return { userId, isSuperAdmin: true, roles: ['SUPER_ADMIN'] };
    }

    const tenantId = resolveTenantId(req, {
      allowHeaderFallback: true,
      allowSingleMembershipFallback: true,
      requireMembership: true,
    });

    const membership = req.user.memberships?.find((item) => item.tenantId === tenantId);
    return { userId, isSuperAdmin: false, tenantId, roles: membership?.roles ?? [] };
  }

  @Get('alerts')
  async listAlerts(
    @Request() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('tenantId') tenantId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.extractActor(req);
    const parsedLimit = limit?.trim() ? Number(limit) : undefined;
    return this.opsService.listAlerts(actor, { status, tenantId, cursor, limit: parsedLimit });
  }

  @Post('alerts/:id/ack')
  async ackAlert(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const actor = this.extractActor(req);
    return this.opsService.ackAlert(actor, id);
  }

  @Post('alerts/:id/resolve')
  async resolveAlert(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const actor = this.extractActor(req);
    return this.opsService.resolveAlert(actor, id);
  }

  @Get('metrics/hitl')
  async getHitlMetrics(
    @Request() req: AuthenticatedRequest,
    @Query('tenantId') tenantId?: string,
  ) {
    const actor = this.extractActor(req);
    return this.opsService.getHitlMetrics(actor, tenantId);
  }

  @Post('metrics/check')
  async enqueueMetricsCheck(
    @Request() req: AuthenticatedRequest,
    @Body() _body: Record<string, never>,
  ) {
    const actor = this.extractActor(req);
    if (!actor.isSuperAdmin) {
      throw new ForbiddenException('Manual metrics check is super-admin only');
    }
    await this.opsMetricsQueue.enqueueManualCheck();
    return { ok: true, queued: true };
  }
}
