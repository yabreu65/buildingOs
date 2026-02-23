import { Injectable, Logger, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { CreateLeadDto, UpdateLeadDto, ConvertLeadDto, ConvertLeadResponseDto } from './leads.dto';
import { AuditAction, TenantType, Role } from '@prisma/client';
import { EmailType } from '../email/email.types';
import * as crypto from 'crypto';

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

  /**
   * Convert a lead to a customer: creates tenant + owner + invitation
   * Atomic transaction to ensure consistency
   */
  async convertLeadToTenant(
    leadId: string,
    dto: ConvertLeadDto,
    superAdminUserId: string,
  ): Promise<ConvertLeadResponseDto> {
    // 1. Fetch lead and validate
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (lead.status === 'DISQUALIFIED') {
      throw new BadRequestException('Cannot convert a DISQUALIFIED lead');
    }

    if (lead.convertedTenantId) {
      throw new ConflictException('Lead already converted to a customer');
    }

    // 2. Use provided values or defaults from lead
    const ownerEmail = dto.ownerEmail || lead.email;
    const ownerFullName = dto.ownerFullName || lead.fullName;
    const tenantType = dto.tenantType || lead.tenantType;

    // Start atomic transaction
    return await this.prisma.$transaction(async (tx) => {
      // 3. Create tenant
      const tenant = await tx.tenant.create({
        data: {
          name: dto.tenantName,
          type: tenantType,
        },
      });

      this.logger.log(`Created tenant ${tenant.id} for lead ${leadId}`);

      // 4. Create subscription with plan
      const planId = dto.planId || (await this.getDefaultPlanId());
      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId,
          status: 'TRIAL',
        },
      });

      // 5. Check if owner user exists
      let ownerUser = await tx.user.findUnique({ where: { email: ownerEmail } });

      if (!ownerUser) {
        // Create new user with temporary password
        const tempPassword = this.generateTemporaryPassword();
        const passwordHash = await this.hashPassword(tempPassword);

        ownerUser = await tx.user.create({
          data: {
            email: ownerEmail,
            name: ownerFullName,
            passwordHash,
          },
        });

        this.logger.log(`Created user ${ownerUser.id} (${ownerEmail})`);
      }

      // 6. Create membership with TENANT_OWNER role
      const membership = await tx.membership.create({
        data: {
          userId: ownerUser.id,
          tenantId: tenant.id,
        },
      });

      // Add roles to membership
      await tx.membershipRole.createMany({
        data: [
          { membershipId: membership.id, role: Role.TENANT_OWNER },
          { membershipId: membership.id, role: Role.TENANT_ADMIN },
        ],
      });

      // 7. Generate invitation token
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const invitation = await tx.invitation.create({
        data: {
          tenantId: tenant.id,
          email: ownerEmail,
          tokenHash,
          roles: JSON.stringify([Role.TENANT_OWNER, Role.TENANT_ADMIN]),
          invitedByMembershipId: membership.id,
          expiresAt,
          status: 'PENDING',
        },
      });

      // 8. Send invitation email (fire-and-forget)
      void this.sendInvitationEmail(ownerEmail, inviteToken, dto.tenantName).catch((error) => {
        this.logger.error(`Failed to send invitation email: ${error.message}`);
      });

      // 9. Update lead status and mark as converted
      await tx.lead.update({
        where: { id: leadId },
        data: {
          status: 'QUALIFIED',
          convertedTenantId: tenant.id,
          convertedAt: new Date(),
        },
      });

      // 10. Audit events (fire-and-forget)
      void this.auditService
        .createLog({
          tenantId: tenant.id,
          actorUserId: superAdminUserId,
          action: AuditAction.TENANT_CREATE,
          entityType: 'Tenant',
          entityId: tenant.id,
          metadata: {
            source: 'lead_conversion',
            leadId,
            tenantType,
          },
        })
        .catch((error) => {
          this.logger.error(`Failed to audit tenant create: ${error.message}`);
        });

      void this.auditService
        .createLog({
          tenantId: tenant.id,
          actorUserId: superAdminUserId,
          action: AuditAction.LEAD_CONVERTED,
          entityType: 'Lead',
          entityId: leadId,
          metadata: {
            tenantId: tenant.id,
            ownerUserId: ownerUser.id,
          },
        })
        .catch((error) => {
          this.logger.error(`Failed to audit lead converted: ${error.message}`);
        });

      return {
        tenantId: tenant.id,
        ownerUserId: ownerUser.id,
        inviteSent: true,
      };
    });
  }

  /**
   * Get default plan ID (TRIAL)
   */
  private async getDefaultPlanId(): Promise<string> {
    const trialPlan = await this.prisma.billingPlan.findFirst({
      where: { name: 'TRIAL' },
    });

    if (!trialPlan) {
      throw new BadRequestException('No default TRIAL plan found');
    }

    return trialPlan.id;
  }

  /**
   * Hash password (simple bcrypt)
   */
  private async hashPassword(password: string): Promise<string> {
    const bcrypt = await import('bcrypt');
    return bcrypt.hash(password, 10);
  }

  /**
   * Generate temporary password
   */
  private generateTemporaryPassword(): string {
    return crypto.randomBytes(12).toString('hex');
  }

  /**
   * Send invitation email to owner
   */
  private async sendInvitationEmail(
    email: string,
    token: string,
    tenantName: string,
  ): Promise<void> {
    const inviteLink = `${this.configService.getValue('appBaseUrl')}/invite?token=${token}`;

    const htmlBody = `
      <h2>Welcome to BuildingOS!</h2>
      <p>Your account has been created for <strong>${this.escapeHtml(tenantName)}</strong>.</p>
      <p><a href="${inviteLink}" style="background-color: #007bff; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Accept Invitation</a></p>
      <p>This invitation expires in 7 days.</p>
      <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
    `;

    await this.emailService.sendEmail(
      {
        to: email,
        subject: `Invitation to ${tenantName} - BuildingOS`,
        htmlBody,
      },
      EmailType.INVITATION,
    );
  }
}
