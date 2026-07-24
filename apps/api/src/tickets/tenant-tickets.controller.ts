import { Controller, Get, Param, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/request.types';
import { TicketsService } from './tickets.service';

/**
 * Canonical tenant-scoped ticket detail endpoint.
 *
 * Route: /tenants/:tenantId/tickets/:ticketId
 */
@Controller('tenants/:tenantId/tickets')
@UseGuards(JwtAuthGuard)
export class TenantTicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  /**
   * GET /tenants/:tenantId/tickets/:ticketId
   */
  @Get(':ticketId')
  async findOne(
    @Param('tenantId') tenantId: string,
    @Param('ticketId') ticketId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ticketsService.findOneByTenantAndId(tenantId, ticketId, req.user);
  }
}
