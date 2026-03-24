import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LeadsService } from './leads.service';
import { CreateLeadDto, SelfRegisterDto } from './leads.dto';

/**
 * PUBLIC LEADS CONTROLLER
 * Marketing funnel entry point - NO authentication required
 * Global rate limiting via middleware
 */
@Controller('leads')
export class PublicLeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  /**
   * PUBLIC ENDPOINT: Submit a new lead from marketing form
   * - No authentication required
   * - Rate limited by IP (global middleware)
   * - Honeypot field for spam prevention
   * - No tenant association (SaaS-scope lead)
   *
   * POST /leads/public
   * Response: { id, email, fullName, status, createdAt, message }
   */
  @Post('public')
  @HttpCode(HttpStatus.CREATED)
  async submitLead(@Body() dto: CreateLeadDto) {
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
   * PUBLIC ENDPOINT: Self-registration
   * - No authentication required
   * - Rate limited by IP (global middleware)
   * - Creates lead + tenant + user + invitation in atomic transaction
   * - Sends welcome email with 24-hour expiry link
   * - Notifies sales team
   *
   * POST /leads/public/register
   * Response: { success: true }
   */
  @Post('public/register')
  @HttpCode(HttpStatus.CREATED)
  async selfRegister(@Body() dto: SelfRegisterDto) {
    return this.leadsService.selfRegister(dto);
  }
}
