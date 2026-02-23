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
} from '@nestjs/common';
import { LeadsService } from './leads.service';
import { CreateLeadDto, UpdateLeadDto } from './leads.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  /**
   * PUBLIC ENDPOINT: Create a new lead from marketing form
   * - No authentication required
   * - Rate limited to prevent spam (via global middleware)
   * - No tenant creation
   */
  @Post('public')
  @HttpCode(HttpStatus.CREATED)
  async createLead(@Body() dto: CreateLeadDto) {
    const lead = await this.leadsService.createLead(dto);

    return {
      id: lead.id,
      email: lead.email,
      fullName: lead.fullName,
      status: lead.status,
      createdAt: lead.createdAt,
      message: 'Lead received. Our sales team will contact you shortly.',
    };
  }

  /**
   * SUPER-ADMIN ENDPOINT: Get a single lead
   */
  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async getLead(@Param('id') id: string) {
    return this.leadsService.getLead(id);
  }

  /**
   * SUPER-ADMIN ENDPOINT: List all leads with filtering
   */
  @Get('admin')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
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
   * SUPER-ADMIN ENDPOINT: Update lead status and notes
   */
  @Patch('admin/:id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  async updateLead(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.updateLead(id, dto);
  }

  /**
   * SUPER-ADMIN ENDPOINT: Delete a lead
   */
  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLead(@Param('id') id: string) {
    await this.leadsService.deleteLead(id);
  }
}
