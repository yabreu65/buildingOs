import { Controller, Get, UseGuards, Req, Query, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { InboxService } from './inbox.service';
import { InboxSummaryResponse } from './inbox.types';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    name: string;
  };
  tenantId?: string;
}

/**
 * InboxController: Unified inbox for tenant
 *
 * GET /inbox/summary - Get pending items and alerts
 */
@Controller('inbox')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  /**
   * GET /inbox/summary
   *
   * Query params:
   * - buildingId?: string (filter by specific building)
   * - limit?: number (default 20, max 100)
   *
   * Response:
   * {
   *   tickets: TicketSummary[],
   *   payments: PaymentSummary[],
   *   communications: CommunicationSummary[],
   *   alerts: AlertSummary
   * }
   */
  @Get('summary')
  async getSummary(
    @Req() req: RequestWithUser,
    @Query('buildingId') buildingId?: string,
    @Query('limit') limitStr?: string,
  ): Promise<InboxSummaryResponse> {
    const userId = req.user.id;
    const tenantId = req.tenantId || req.headers['x-tenant-id'];

    if (!tenantId || typeof tenantId !== 'string') {
      throw new BadRequestException('Tenant ID is required');
    }

    // Parse and validate limit
    let limit = 20;
    if (limitStr) {
      const parsed = parseInt(limitStr, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 100) {
        throw new BadRequestException('Limit must be between 1 and 100');
      }
      limit = parsed;
    }

    return this.inboxService.getInboxSummary(userId, tenantId, buildingId, limit);
  }
}
