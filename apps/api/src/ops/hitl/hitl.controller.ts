import {
  BadRequestException,
  Body,
  Controller,
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
import { HitlService } from './hitl.service';
import { HitlActorContext, HitlListQuery } from './hitl.types';

@Controller('ops/hitl/handoffs')
@UseGuards(JwtAuthGuard)
export class HitlController {
  constructor(private readonly hitlService: HitlService) {}

  private extractActor(req: AuthenticatedRequest): HitlActorContext {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('Authenticated user required');
    }

    const directRoles = req.user?.roles ?? [];
    const isSuperAdmin = directRoles.includes('SUPER_ADMIN');

    if (isSuperAdmin) {
      return {
        userId,
        isSuperAdmin: true,
        roles: ['SUPER_ADMIN'],
      };
    }

    const tenantId = resolveTenantId(req, {
      allowHeaderFallback: true,
      allowSingleMembershipFallback: true,
      requireMembership: true,
    });

    const membership = req.user.memberships?.find((item) => item.tenantId === tenantId);

    return {
      userId,
      isSuperAdmin: false,
      tenantId,
      roles: membership?.roles ?? [],
    };
  }

  @Get()
  async list(
    @Request() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('tenantId') tenantId?: string,
    @Query('fallbackPath') fallbackPath?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = this.extractActor(req);

    const parsedLimit =
      limit && limit.trim().length > 0
        ? Number(limit)
        : undefined;

    const query: HitlListQuery = {
      status,
      tenantId,
      fallbackPath,
      cursor,
      ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
    };

    return this.hitlService.list(actor, query);
  }

  @Get(':id')
  async getById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const actor = this.extractActor(req);
    return this.hitlService.getById(actor, id);
  }

  @Post(':id/assign')
  async assign(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const actor = this.extractActor(req);
    return this.hitlService.assign(actor, id);
  }

  @Post(':id/resolve')
  async resolve(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { resolutionNote?: string; notifyUser?: boolean },
  ) {
    const actor = this.extractActor(req);
    return this.hitlService.resolve(
      actor,
      id,
      body?.resolutionNote ?? '',
      { notifyUser: body?.notifyUser === true },
    );
  }

  @Post(':id/dismiss')
  async dismiss(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const actor = this.extractActor(req);
    return this.hitlService.dismiss(actor, id);
  }
}
