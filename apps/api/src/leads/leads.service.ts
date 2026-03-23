import { Injectable, Logger, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { CreateLeadDto, UpdateLeadDto, ConvertLeadDto, ConvertLeadResponseDto } from './leads.dto';
import { AuditAction, Role } from '@prisma/client';
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
   * - Sends notification email based on intent (DEMO → sales@, CONTACT → info@)
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
        source: dto.source || (dto.intent === 'DEMO' ? 'landing' : 'contact-form'),
        intent: (dto.intent as any) || 'CONTACT',
        status: 'NEW',
      },
    });

    // Send notification email to appropriate team (fire-and-forget)
    void this.notifyTeam(lead).catch((error) => {
      this.logger.error(`Failed to notify team about lead ${lead.id}: ${error.message}`);
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
          intent: lead.intent,
          source: lead.source,
        },
      })
      .catch((error) => {
        this.logger.error(`Failed to audit lead creation: ${error.message}`);
      });

    return lead;
  }

  /**
   * Get a single lead by ID with converted tenant details (super-admin only)
   */
  async getLead(id: string): Promise<any> {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    // If lead is converted, fetch tenant and subscription details
    let convertedTenant = null;
    if (lead.convertedTenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: lead.convertedTenantId },
        select: {
          id: true,
          name: true,
          type: true,
        },
      });

      if (tenant) {
        const subscription = await this.prisma.subscription.findFirst({
          where: { tenantId: lead.convertedTenantId },
          select: {
            id: true,
            status: true,
            planId: true,
            plan: {
              select: {
                planId: true,
                name: true,
              },
            },
          },
        });

        convertedTenant = {
          ...tenant,
          subscription: subscription || null,
        };
      }
    }

    return {
      ...lead,
      convertedTenant,
    };
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
   * Send notification email to appropriate team based on lead intent
   * DEMO → sales@, CONTACT → info@ (or sales@ if info@ not configured)
   */
  private async notifyTeam(lead: any): Promise<void> {
    // Get config values (may be undefined)
    const salesTeamEmail = this.configService.getValue('salesTeamEmail') as string | undefined;
    const infoEmail = this.configService.getValue('infoEmail') as string | undefined;

    // Determine recipient email based on intent
    let recipientEmail: string | undefined;

    if (lead.intent === 'DEMO') {
      recipientEmail = salesTeamEmail;
    } else {
      // CONTACT intent → try info@ first, fallback to sales@
      recipientEmail = infoEmail || salesTeamEmail;
    }

    if (!recipientEmail) {
      this.logger.warn(
        `No email configured for lead intent ${lead.intent}, skipping notification`
      );
      return;
    }

    const intentLabel = lead.intent === 'DEMO' ? 'DEMO REQUEST' : 'CONTACT FORM';
    const subject = `${intentLabel}: ${lead.fullName} (${lead.tenantType})`;

    const htmlBody = `
      <h2>New ${intentLabel}</h2>
      <p><strong>Name:</strong> ${this.escapeHtml(lead.fullName)}</p>
      <p><strong>Email:</strong> <a href="mailto:${this.escapeHtml(lead.email)}">${this.escapeHtml(lead.email)}</a></p>
      ${lead.phone ? `<p><strong>Phone:</strong> ${this.escapeHtml(lead.phone)}</p>` : ''}
      <p><strong>Type:</strong> ${lead.tenantType}</p>
      <p><strong>Intent:</strong> <strong style="color: ${lead.intent === 'DEMO' ? '#2563eb' : '#059669'}">${lead.intent}</strong></p>
      ${lead.buildingsCount ? `<p><strong>Buildings:</strong> ${lead.buildingsCount}</p>` : ''}
      <p><strong>Units Estimate:</strong> ${lead.unitsEstimate}</p>
      ${lead.location ? `<p><strong>Location:</strong> ${this.escapeHtml(lead.location)}</p>` : ''}
      ${lead.source ? `<p><strong>Source:</strong> ${this.escapeHtml(lead.source)}</p>` : ''}
      ${
        lead.message
          ? `<p><strong>Message:</strong></p><p>${this.escapeHtml(lead.message).replace(/\n/g, '<br>')}</p>`
          : ''
      }
      <p><strong>Lead ID:</strong> <code>${lead.id}</code></p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p style="color: #666; font-size: 12px;">
        <a href="http://localhost:3000/super-admin/leads/${lead.id}">View in dashboard</a> |
        Submitted: ${lead.createdAt.toISOString()}
      </p>
    `;

    await this.emailService.sendEmail(
      {
        to: recipientEmail,
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
    return text.replace(/[&<>"']/g, (char) => map[char] || char);
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
    this.logger.log(`[CONVERT] Starting conversion for leadId: ${leadId}`);
    this.logger.log(`[CONVERT] Payload: tenantName="${dto.tenantName}", tenantType="${dto.tenantType}"`);

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
    const ownerEmail = (dto.ownerEmail || lead.email).trim().toLowerCase();
    const ownerFullName = dto.ownerFullName || lead.fullName;
    const tenantType = dto.tenantType || lead.tenantType;

    // Validate ownerEmail
    if (!ownerEmail || ownerEmail.length === 0) {
      throw new BadRequestException('Owner email is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(ownerEmail)) {
      throw new BadRequestException(`Invalid owner email: ${ownerEmail}`);
    }

    this.logger.log(`[CONVERT] Using owner email: ${ownerEmail}`);

    // Start atomic transaction
    return await this.prisma.$transaction(async (tx) => {
      // 3. Create tenant
      this.logger.log(`[CONVERT] Creating tenant with name="${dto.tenantName}", type="${tenantType}"`);

      const tenant = await tx.tenant.create({
        data: {
          name: dto.tenantName,
          type: tenantType,
        },
      });

      this.logger.log(`[CONVERT] ✓ Tenant created: ${tenant.id}`);

      // 4. Create subscription with plan
      this.logger.log(`[CONVERT] Creating subscription...`);

      // Get billing plan (default BASIC, fallback to FREE)
      const billingPlan = await this.getDefaultBillingPlan();

      // Calculate trial period (14 days from now)
      const now = new Date();
      const trialEndDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

      // Check if subscription already exists (idempotence)
      const existingSubscription = await tx.subscription.findUnique({
        where: { tenantId: tenant.id },
      });

      if (existingSubscription) {
        this.logger.warn(`[CONVERT] Subscription already exists for tenant ${tenant.id}`);
        throw new ConflictException('Subscription already exists for this tenant');
      }

      const subscription = await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: billingPlan.id,
          status: 'TRIAL',
          trialEndDate,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndDate,
        },
      });
      this.logger.log(`[CONVERT] ✓ Subscription created: ${subscription.id}, trial ends ${trialEndDate.toISOString()}`);

      // 5. Check if owner user exists
      this.logger.log(`[CONVERT] Checking if user exists: ${ownerEmail}`);
      let ownerUser = await tx.user.findUnique({ where: { email: ownerEmail } });

      if (!ownerUser) {
        // Create new user with temporary password
        this.logger.log(`[CONVERT] Creating new user ${ownerEmail}`);
        const tempPassword = this.generateTemporaryPassword();
        const passwordHash = await this.hashPassword(tempPassword);

        ownerUser = await tx.user.create({
          data: {
            email: ownerEmail,
            name: ownerFullName,
            passwordHash,
          },
        });

        this.logger.log(`[CONVERT] ✓ User created: ${ownerUser.id}`);
      } else {
        this.logger.log(`[CONVERT] ✓ User already exists: ${ownerUser.id}`);
      }

      // 6. Create membership with TENANT_OWNER role
      this.logger.log(`[CONVERT] Creating membership for user ${ownerUser.id} in tenant ${tenant.id}`);
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
      this.logger.log(`[CONVERT] ✓ Membership created with roles`);

      // 7. Generate invitation token
      this.logger.log(`[CONVERT] Generating invitation token...`);
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
      this.logger.log(`[CONVERT] ✓ Invitation created`);

      // 8. Send invitation email (fire-and-forget)
      this.logger.log(`[CONVERT] Sending invitation email...`);
      void this.sendInvitationEmail(ownerEmail, inviteToken, dto.tenantName).catch((error) => {
        this.logger.error(`Failed to send invitation email: ${error.message}`);
      });

      // 9. Update lead status and mark as converted
      this.logger.log(`[CONVERT] Updating lead status and marking as converted...`);
      await tx.lead.update({
        where: { id: leadId },
        data: {
          status: 'QUALIFIED',
          convertedTenantId: tenant.id,
          convertedAt: new Date(),
        },
      });
      this.logger.log(`[CONVERT] ✓ Lead updated`);

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

      this.logger.log(`[CONVERT] ✓✓✓ CONVERSION COMPLETE: tenantId=${tenant.id}, leadId=${leadId}, plan=${billingPlan.planId}`);

      return {
        tenantId: tenant.id,
        ownerUserId: ownerUser.id,
        inviteSent: true,
        plan: billingPlan.planId,
        subscriptionStatus: 'TRIAL',
        trialEndDate: trialEndDate.toISOString(),
      };
    });
  }

  /**
   * Get default plan (BASIC with fallback to FREE)
   * Used for new tenant conversions
   */
  private async getDefaultBillingPlan() {
    // Try BASIC first
    let plan = await this.prisma.billingPlan.findFirst({
      where: { planId: 'BASIC' },
    });

    // Fallback to FREE if BASIC doesn't exist
    if (!plan) {
      plan = await this.prisma.billingPlan.findFirst({
        where: { planId: 'FREE' },
      });
    }

    // No plans seeded at all - fatal error
    if (!plan) {
      this.logger.error('[CONVERT] FATAL: No BillingPlans found in database. Run seed first.');
      throw new BadRequestException('BillingPlans not seeded. Please initialize database.');
    }

    this.logger.log(`[CONVERT] Using default plan: ${plan.planId}`);
    return plan;
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
