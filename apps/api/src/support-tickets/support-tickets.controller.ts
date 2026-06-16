import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
  Request,
} from '@nestjs/common';
import {
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { SupportTicketsService } from './support-tickets.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { UpdateSupportTicketDto, AddSupportTicketCommentDto, AssignSupportTicketDto, UpdateSupportTicketStatus } from './dto/update-support-ticket.dto';

/**
 * Support Tickets Controller
 *
 * ENDPOINTS:
 *
 * SUPER_ADMIN:
 * GET    /super-admin/support                    → List all support tickets
 * GET    /super-admin/support/:id                → Get ticket details
 * PATCH  /super-admin/support/:id                → Update ticket
 * PATCH  /super-admin/support/:id/status         → Change status
 * PATCH  /super-admin/support/:id/assign         → Assign ticket
 * DELETE /super-admin/support/:id                → Close ticket
 * POST   /super-admin/support/:id/comments       → Add comment
 *
 * TENANT_ADMIN:
 * GET    /:tenantId/support                      → List own support tickets
 * POST   /:tenantId/support                      → Create support ticket
 * GET    /:tenantId/support/:id                  → Get own ticket details
 * PATCH  /:tenantId/support/:id                  → Update own ticket
 * POST   /:tenantId/support/:id/comments         → Comment on own ticket
 */

@Controller()
@UseGuards(JwtAuthGuard)
export class SupportTicketsController {
  constructor(private supportTicketsService: SupportTicketsService) {}

  // ============================================================================
  // SUPER_ADMIN ENDPOINTS: View and manage all support tickets
  // ============================================================================

  /**
   * Super-admin: List all support tickets (with filters)
   * GET /super-admin/support?status=OPEN&skip=0&take=50
   */
  @Get('super-admin/support')
  async listAllTickets(
    @Request() req: AuthenticatedRequest,
    @Query('status') status?: SupportTicketStatus,
    @Query('category') category?: SupportTicketCategory,
    @Query('priority') priority?: SupportTicketPriority,
    @Query('skip') skip: string = '0',
    @Query('take') take: string = '50',
  ) {
    const user = req.user;
    const skipNum = Math.max(0, parseInt(skip, 10));
    const takeNum = Math.min(100, parseInt(take, 10) || 50);

    return this.supportTicketsService.findAll(
      null, // Super-admin sees all, no tenant filter
      user.id,
      user.roles || [],
      skipNum,
      takeNum,
      { status, category, priority },
    );
  }

  /**
   * Super-admin: Get single support ticket
   * GET /super-admin/support/:id
   */
  @Get('super-admin/support/:id')
  async getTicket(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const user = req.user;
    return this.supportTicketsService.findOne(id, null, user.roles || []);
  }

  /**
   * Super-admin: Update support ticket (title, description, priority)
   * PATCH /super-admin/support/:id
   */
  @Patch('super-admin/support/:id')
  async updateTicket(
    @Param('id') id: string,
    @Body() dto: UpdateSupportTicketDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const user = req.user;
    return this.supportTicketsService.update(id, null, user.id, user.roles || [], dto);
  }

  /**
   * Super-admin: Change ticket status
   * PATCH /super-admin/support/:id/status
   */
  @Patch('super-admin/support/:id/status')
  async updateTicketStatus(
    @Param('id') id: string,
    @Body('status') status: UpdateSupportTicketStatus,
    @Request() req: AuthenticatedRequest,
  ) {
    const user = req.user;
    if (!status) {
      throw new BadRequestException('Status is required');
    }
    return this.supportTicketsService.updateStatus(
      id,
      null,
      user.id,
      user.roles || [],
      status as SupportTicketStatus,
    );
  }

  /**
   * Super-admin: Assign ticket to user
   * PATCH /super-admin/support/:id/assign
   */
  @Patch('super-admin/support/:id/assign')
  async assignTicket(
    @Param('id') id: string,
    @Body() dto: AssignSupportTicketDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const user = req.user;
    return this.supportTicketsService.assign(id, null, user.id, user.roles || [], dto);
  }

  /**
   * Super-admin: Close support ticket
   * DELETE /super-admin/support/:id
   */
  @Delete('super-admin/support/:id')
  async closeTicket(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const user = req.user;
    return this.supportTicketsService.close(id, null, user.id, user.roles || []);
  }

  /**
   * Super-admin: Add comment to support ticket
   * POST /super-admin/support/:id/comments
   */
  @Post('super-admin/support/:id/comments')
  async addCommentAdmin(
    @Param('id') id: string,
    @Body() dto: AddSupportTicketCommentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const user = req.user;
    return this.supportTicketsService.addComment(id, null, user.id, user.roles || [], dto);
  }

  // ============================================================================
  // TENANT ADMIN ENDPOINTS: View and manage own support tickets
  // ============================================================================

  /**
   * Tenant-admin: List own support tickets
   * GET /:tenantId/support?status=OPEN
   */
  @Get(':tenantId/support')
  async listTenantTickets(
    @Param('tenantId') tenantId: string,
    @Request() req: AuthenticatedRequest,
    @Query('status') status?: SupportTicketStatus,
    @Query('category') category?: SupportTicketCategory,
    @Query('skip') skip: string = '0',
    @Query('take') take: string = '50',
  ) {
    const user = req.user;
    const skipNum = Math.max(0, parseInt(skip, 10));
    const takeNum = Math.min(100, parseInt(take, 10) || 50);

    return this.supportTicketsService.findAll(
      tenantId,
      user.id,
      user.roles || [],
      skipNum,
      takeNum,
      { status, category },
    );
  }

  /**
   * Tenant-admin: Create support ticket
   * POST /:tenantId/support
   */
  @Post(':tenantId/support')
  async createTicket(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateSupportTicketDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const user = req.user;
    return this.supportTicketsService.create(tenantId, user.id, dto);
  }

  /**
   * Tenant-admin: Get own support ticket
   * GET /:tenantId/support/:id
   */
  @Get(':tenantId/support/:id')
  async getTenantTicket(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const user = req.user;
    return this.supportTicketsService.findOne(id, tenantId, user.roles || []);
  }

  /**
   * Tenant-admin: Update own support ticket
   * PATCH /:tenantId/support/:id
   */
  @Patch(':tenantId/support/:id')
  async updateTenantTicket(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSupportTicketDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const user = req.user;
    return this.supportTicketsService.update(id, tenantId, user.id, user.roles || [], dto);
  }

  /**
   * Tenant-admin: Add comment to own support ticket
   * POST /:tenantId/support/:id/comments
   */
  @Post(':tenantId/support/:id/comments')
  async addCommentTenant(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: AddSupportTicketCommentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const user = req.user;
    return this.supportTicketsService.addComment(id, tenantId, user.id, user.roles || [], dto);
  }
}
