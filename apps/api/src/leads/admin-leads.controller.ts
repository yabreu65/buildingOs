import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { LeadsService } from './leads.service';
import { UpdateLeadDto, ConvertLeadDto, ConvertLeadResponseDto } from './leads.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';

/**
 * ADMIN LEADS CONTROLLER
 * Lead management for SUPER_ADMIN only
 * Controls lead lifecycle: view, update status, convert to customer
 *
 * All endpoints require:
 * - Valid JWT token
 * - SUPER_ADMIN role
 */
@Controller('leads/admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminLeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  /**
   * List all leads with filtering and pagination
   *
   * GET /leads/admin
   * Query params:
   * - status?: "NEW" | "CONTACTED" | "QUALIFIED" | "DISQUALIFIED"
   * - email?: string (partial match)
   * - source?: string
   * - skip?: number (default 0)
   * - take?: number (default 50, max 100)
   *
   * Response: { data: Lead[], total: number, page: number }
   */
  @Get()
  async listLeads(
    @Query('status') status?: string,
    @Query('email') email?: string,
    @Query('source') source?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const { data, total } = await this.leadsService.listLeads({
      status,
      email,
      source,
      skip: skip ? parseInt(skip, 10) : 0,
      take: Math.min(take ? parseInt(take, 10) : 50, 100), // Max 100 per page
    });

    return {
      data,
      total,
      page: Math.floor((skip ? parseInt(skip, 10) : 0) / (take ? parseInt(take, 10) : 50)),
    };
  }

  /**
   * Get a single lead by ID
   *
   * GET /leads/admin/:id
   * Response: Lead (full details)
   */
  @Get(':id')
  async getLead(@Param('id') id: string) {
    return this.leadsService.getLead(id);
  }

  /**
   * Update lead status and internal notes
   *
   * PATCH /leads/admin/:id
   * Body:
   * {
   *   status?: "NEW" | "CONTACTED" | "QUALIFIED" | "DISQUALIFIED",
   *   notes?: string (max 2000 chars)
   * }
   *
   * Response: Updated Lead
   */
  @Patch(':id')
  async updateLead(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.updateLead(id, dto);
  }

  /**
   * Convert lead to customer: creates tenant + owner + sends invitation
   *
   * POST /leads/admin/:id/convert
   * Body:
   * {
   *   tenantName: string (required),
   *   tenantType?: "ADMINISTRADORA" | "EDIFICIO_AUTOGESTION",
   *   ownerEmail?: string,
   *   ownerFullName?: string,
   *   planId?: string,
   *   createDemoData?: boolean
   * }
   *
   * Response:
   * {
   *   tenantId: string,
   *   ownerUserId: string,
   *   inviteSent: boolean
   * }
   *
   * Notes:
   * - Atomic transaction ensures consistency
   * - Creates Membership with TENANT_OWNER + TENANT_ADMIN roles
   * - Generates 7-day invitation token
   * - Sends email to owner with accept link
   * - Updates lead.status to QUALIFIED and sets convertedTenantId
   * - Prevents double-conversion
   */
  @Post(':id/convert')
  @HttpCode(HttpStatus.CREATED)
  async convertLead(
    @Param('id') id: string,
    @Body() dto: ConvertLeadDto,
    @Request() req: any,
  ): Promise<ConvertLeadResponseDto> {
    const superAdminUserId = req.user?.id;
    return this.leadsService.convertLeadToTenant(id, dto, superAdminUserId);
  }

  /**
   * Delete a lead (soft or hard delete)
   * Use with caution - audit trail is preserved
   *
   * DELETE /leads/admin/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLead(@Param('id') id: string) {
    await this.leadsService.deleteLead(id);
  }
}
