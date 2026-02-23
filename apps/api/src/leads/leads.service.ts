import { Injectable, Logger, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { CreateLeadDto, UpdateLeadDto } from './leads.dto';
import { AuditAction } from '@prisma/client';
import { EmailType } from '../email/email.types';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger('LeadsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a new lead from marketing form submission
   * - Checks for email uniqueness
   * - Sends notification email to sales team
   * - Logs audit event
   * - NO TENANT CREATION
   */
  async createLead(dto: CreateLeadDto): Promise<any> {
    // Check if email already exists
    const existingLead = await this.prisma.lead.findUnique({
      where: { email: dto.email },
    });

    if (existingLead) {
      throw new ConflictException('Lead with this email already exists');
    }

    // Create lead record
    const lead = await this.prisma.lead.create({
      data: {
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phoneWhatsapp,
        tenantType: dto.tenantType,
        buildingsCount: dto.buildingsCount,
        unitsEstimate: dto.unitsEstimate,
        location: dto.countryCity,
        message: dto.message,
        source: dto.source,
        status: 'NEW',
      },
    });

    // Send notification email to sales team (fire-and-forget)
    void this.notifySalesTeam(lead).catch((error) => {
      this.logger.error(`Failed to notify sales team about lead ${lead.id}: ${error.message}`);
    });

    // Log audit event (fire-and-forget)
    void this.auditService
      .createLog({
        // Leads are global, not scoped to tenant
        // Use a system audit without tenantId
        action: AuditAction.LEAD_CREATED,
        entityType: 'Lead',
        entityId: lead.id,
        metadata: {
          email: lead.email,
          fullName: lead.fullName,
          tenantType: lead.tenantType,
          source: lead.source,
        },
      })
      .catch((error) => {
        this.logger.error(`Failed to audit lead creation: ${error.message}`);
      });

    return lead;
  }

  /**
   * Get a single lead by ID (super-admin only)
   */
  async getLead(id: string): Promise<any> {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return lead;
  }

  /**
   * List all leads with filtering and pagination (super-admin only)
   */
  async listLeads(
    filter?: {
      status?: string;
      email?: string;
      source?: string;
      skip?: number;
      take?: number;
    },
  ): Promise<{ data: any[]; total: number }> {
    const skip = filter?.skip || 0;
    const take = filter?.take || 50;

    // Build where clause
    const where: any = {};
    if (filter?.status) {
      where.status = filter.status;
    }
    if (filter?.email) {
      where.email = { contains: filter.email, mode: 'insensitive' };
    }
    if (filter?.source) {
      where.source = filter.source;
    }

    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { data, total };
  }

  /**
   * Update lead status and notes (super-admin only)
   */
  async updateLead(id: string, dto: UpdateLeadDto): Promise<any> {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    // Only allow updates to status and notes
    const updateData: any = {};
    if (dto.status) {
      updateData.status = dto.status;
    }
    if (dto.notes !== undefined) {
      updateData.notes = dto.notes;
    }

    // If status is being changed to CONTACTED, set contactedAt timestamp
    if (dto.status === 'CONTACTED' && lead.status !== 'CONTACTED') {
      updateData.contactedAt = new Date();
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data: updateData,
    });

    // Audit status change (fire-and-forget)
    if (dto.status) {
      void this.auditService
        .createLog({
          action: AuditAction.LEAD_STATUS_CHANGED,
          entityType: 'Lead',
          entityId: id,
          metadata: {
            email: lead.email,
            previousStatus: lead.status,
            newStatus: dto.status,
          },
        })
        .catch((error) => {
          this.logger.error(`Failed to audit lead update: ${error.message}`);
        });
    }

    return updated;
  }

  /**
   * Delete a lead (super-admin only)
   */
  async deleteLead(id: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    await this.prisma.lead.delete({
      where: { id },
    });

    // Audit deletion (fire-and-forget)
    void this.auditService
      .createLog({
        action: AuditAction.LEAD_DELETED,
        entityType: 'Lead',
        entityId: id,
        metadata: {
          email: lead.email,
          fullName: lead.fullName,
        },
      })
      .catch((error) => {
        this.logger.error(`Failed to audit lead deletion: ${error.message}`);
      });
  }

  /**
   * Send notification email to sales team about new lead
   */
  private async notifySalesTeam(lead: any): Promise<void> {
    const salesEmail = this.configService.getValue('salesTeamEmail');
    if (!salesEmail || typeof salesEmail !== 'string') {
      this.logger.warn('SALES_TEAM_EMAIL not configured, skipping sales notification');
      return;
    }

    const subject = `New Lead: ${lead.fullName} (${lead.tenantType})`;

    const htmlBody = `
      <h2>New Lead Submission</h2>
      <p><strong>Name:</strong> ${this.escapeHtml(lead.fullName)}</p>
      <p><strong>Email:</strong> <a href="mailto:${this.escapeHtml(lead.email)}">${this.escapeHtml(lead.email)}</a></p>
      ${lead.phone ? `<p><strong>Phone:</strong> ${this.escapeHtml(lead.phone)}</p>` : ''}
      <p><strong>Tenant Type:</strong> ${lead.tenantType}</p>
      ${lead.buildingsCount ? `<p><strong>Buildings Count:</strong> ${lead.buildingsCount}</p>` : ''}
      <p><strong>Units Estimate:</strong> ${lead.unitsEstimate}</p>
      ${lead.location ? `<p><strong>Location:</strong> ${this.escapeHtml(lead.location)}</p>` : ''}
      ${lead.source ? `<p><strong>Source:</strong> ${this.escapeHtml(lead.source)}</p>` : ''}
      ${
        lead.message
          ? `<p><strong>Message:</strong></p><p>${this.escapeHtml(lead.message).replace(/\n/g, '<br>')}</p>`
          : ''
      }
      <p><strong>Lead ID:</strong> ${lead.id}</p>
      <p style="color: #999; font-size: 12px;">Submitted at: ${lead.createdAt.toISOString()}</p>
    `;

    await this.emailService.sendEmail(
      {
        to: salesEmail,
        subject,
        htmlBody,
        replyTo: lead.email,
      },
      EmailType.LEAD_NOTIFICATION,
    );
  }

  /**
   * Escape HTML to prevent XSS in emails
   */
  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (char) => map[char]);
  }
}
