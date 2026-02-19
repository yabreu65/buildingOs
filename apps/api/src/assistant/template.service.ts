/**
 * AI Template Service
 *
 * Manages AI templates - pre-configured tasks that reduce tokens and standardize results.
 * Templates include: ticket replies, communication drafts, payment reminders, inbox prioritization.
 *
 * Features:
 * - Permission-based visibility (only allowed templates shown)
 * - Scope-aware (TENANT/BUILDING/UNIT)
 * - Structured input (reduce tokens vs free chat)
 * - Lower output token limits (250-350 typical)
 * - Context enrichment integration
 */

import { Injectable, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiRouterService } from './router.service';
import { AiCacheService } from './cache.service';
import { AiContextSummaryService } from './context-summary.service';
import { AiBudgetService } from './budget.service';
import { AuditService } from '../audit/audit.service';
import { AssistantService, ChatResponse } from './assistant.service';

export interface TemplateInput {
  [key: string]: string | number | null;
}

export interface TemplateRunRequest {
  templateKey: string;
  context: {
    buildingId?: string;
    unitId?: string;
    page: string;
  };
  input: TemplateInput;
}

export interface TemplateRunResponse {
  answer: string;
  suggestedActions: any[];
  followUpQuestions?: string[];
}

@Injectable()
export class AiTemplateService {
  constructor(
    private prisma: PrismaService,
    private assistant: AssistantService,
    private router: AiRouterService,
    private cache: AiCacheService,
    private contextSummary: AiContextSummaryService,
    private budget: AiBudgetService,
    private audit: AuditService,
  ) {}

  /**
   * Get available templates for user (permission-filtered)
   *
   * @param tenantId Tenant ID
   * @param userRoles User roles for permission checking
   * @param scopeType Scope filter (optional)
   * @returns List of available templates
   */
  async getAvailableTemplates(
    tenantId: string,
    userRoles: string[],
    scopeType?: string,
  ) {
    // Get templates available for this tenant
    const where: any = {
      isActive: true,
      enabledByDefault: true,
      OR: [
        { tenantId: null }, // Global templates
        { tenantId }, // Tenant-specific
      ],
    };

    if (scopeType) {
      where.scopeType = scopeType;
    }

    const templates = await this.prisma.aiTemplate.findMany({
      where,
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        scopeType: true,
        category: true,
        requiredPermissions: true,
        maxOutputTokens: true,
      },
    });

    // Filter by permissions
    return templates.filter(t => this.hasPermissions(userRoles, t.requiredPermissions));
  }

  /**
   * Run a template and generate output
   *
   * @param tenantId Tenant ID
   * @param membershipId User membership ID
   * @param userId User ID
   * @param userRoles User roles
   * @param request Template run request
   * @returns Template output
   */
  async runTemplate(
    tenantId: string,
    membershipId: string,
    userId: string,
    userRoles: string[],
    request: TemplateRunRequest,
  ): Promise<TemplateRunResponse> {
    // Validate request
    if (!request.templateKey || request.templateKey.trim().length === 0) {
      throw new BadRequestException('templateKey is required');
    }

    // Get template
    const template = await this.prisma.aiTemplate.findFirst({
      where: {
        key: request.templateKey,
        isActive: true,
        OR: [
          { tenantId: null },
          { tenantId },
        ],
      },
    });

    if (!template) {
      throw new BadRequestException('Template not found or not active');
    }

    // Check permissions
    if (!this.hasPermissions(userRoles, template.requiredPermissions)) {
      throw new ForbiddenException(
        `Missing required permissions: ${Array.from(
          new Set(JSON.parse(template.requiredPermissions as string) as string[])
        ).join(', ')}`
      );
    }

    // Step 1: Check budget before execution
    const budgetCheck = await this.budget.checkBudget(tenantId);

    if (!budgetCheck.allowed) {
      throw new ConflictException({
        code: 'BUDGET_EXCEEDED',
        message: 'Monthly AI budget exceeded',
        metadata: {
          spent: budgetCheck.usedCents,
          budget: budgetCheck.budgetCents,
          remaining: budgetCheck.remainingCents,
          percentUsed: budgetCheck.percentUsed,
        },
      });
    }

    // Step 2: Get context enrichment snapshot
    const contextSummary = await this.contextSummary.getSummary({
      tenantId,
      membershipId,
      buildingId: request.context.buildingId,
      unitId: request.context.unitId,
      page: request.context.page,
      userRoles,
    }).catch((err) => {
      // Fire-and-forget: log error but don't fail the request
      console.warn('[TemplateService] Context enrichment failed:', err.message);
      return { summaryVersion: null, snapshot: null };
    });

    // Step 3: Build final prompt from template + input
    const finalPrompt = this.buildPrompt(template.promptUser, request.input);

    // Step 4: Create chat request for the template
    const chatRequest = {
      message: finalPrompt,
      page: request.context.page,
      buildingId: request.context.buildingId,
      unitId: request.context.unitId,
    };

    // Step 5: Use assistant service to get response
    // This will use router, cache, context enrichment automatically
    const response = await this.assistant.chat(
      tenantId,
      userId,
      membershipId,
      chatRequest,
      userRoles,
    );

    // Step 6: Log to audit trail (fire-and-forget)
    this.audit.createLog({
      tenantId,
      action: 'AI_TEMPLATE_RUN',
      entityType: 'AI_TEMPLATE',
      entityId: template.id,
      actorUserId: userId,
      actorMembershipId: membershipId,
      metadata: {
        templateKey: template.key,
        templateScope: template.scopeType,
        category: template.category,
        contextScope: {
          buildingId: request.context.buildingId || null,
          unitId: request.context.unitId || null,
        },
        contextSummaryVersion: contextSummary.summaryVersion,
        contextIncluded: contextSummary.snapshot !== null,
      },
    }).catch((err) => {
      // Fire-and-forget: log error but don't fail the response
      console.warn('[TemplateService] Audit logging failed:', err.message);
    });

    // Return response with template context
    return {
      answer: response.answer,
      suggestedActions: response.suggestedActions,
      followUpQuestions: this.generateFollowUpQuestions(template.key, response),
    };
  }

  /**
   * Build final prompt from template + user input
   *
   * @private
   */
  private buildPrompt(template: string, input: TemplateInput): string {
    let prompt = template;

    // Replace all variables
    for (const [key, value] of Object.entries(input)) {
      const placeholder = `{{${key}}}`;
      const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      prompt = prompt.replace(regex, String(value || ''));
    }

    return prompt;
  }

  /**
   * Check if user has required permissions
   *
   * @private
   */
  private hasPermissions(
    userRoles: string[],
    requiredPermissionsJson: string | any,
  ): boolean {
    // SUPER_ADMIN has all permissions
    if (userRoles.includes('SUPER_ADMIN')) {
      return true;
    }

    // TENANT_OWNER, TENANT_ADMIN have most permissions
    if (userRoles.includes('TENANT_OWNER') || userRoles.includes('TENANT_ADMIN')) {
      return true;
    }

    // For other roles, check required permissions
    const requiredPermissions = typeof requiredPermissionsJson === 'string'
      ? (JSON.parse(requiredPermissionsJson) as string[])
      : (requiredPermissionsJson as string[]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true; // No special permissions required
    }

    // OPERATOR can use templates that don't require finance or comms
    if (userRoles.includes('OPERATOR')) {
      const isAllowed = !requiredPermissions.some(p =>
        p.includes('finance') || p.includes('communications.publish')
      );
      return isAllowed;
    }

    // RESIDENT can only use templates that require tickets.read
    if (userRoles.includes('RESIDENT')) {
      return requiredPermissions.every(p =>
        p.includes('tickets') && !p.includes('write')
      );
    }

    return false;
  }

  /**
   * Generate follow-up questions based on template
   *
   * @private
   */
  private generateFollowUpQuestions(templateKey: string, response: ChatResponse): string[] {
    // Map templates to relevant follow-up questions
    const followUpMap: Record<string, string[]> = {
      INBOX_PRIORITIZE: [
        '¿Ver tickets prioritarios?',
        '¿Filtrar por building?',
      ],
      TICKET_REPLY_DRAFT: [
        '¿Revisar comunicaciones asociadas?',
        '¿Agregar documento adjunto?',
      ],
      COMMUNICATION_DRAFT_GENERAL: [
        '¿Ajustar tono?',
        '¿Agregar cronograma?',
      ],
      COMMUNICATION_PAYMENT_REMINDER: [
        '¿Ver métodos de pago aceptados?',
        '¿Personalizar monto?',
      ],
      FINANCE_EXPLAIN_BALANCE: [
        '¿Ver histórico de pagos?',
        '¿Solicitar prórroga?',
      ],
    };

    return followUpMap[templateKey] || [];
  }

  /**
   * Create default templates (seed)
   */
  async seedDefaultTemplates(tenantId?: string): Promise<void> {
    const templates = [
      {
        key: 'INBOX_PRIORITIZE',
        name: 'Priorizar Bandeja',
        description: 'Organiza y prioriza tareas pendientes',
        scopeType: 'TENANT' as const,
        requiredPermissions: ['tickets.read'],
        promptUser: `Tengo estas tareas pendientes en mi bandeja:
{{pending_items}}

Por favor, priorízalas según urgencia y propón acciones.`,
        category: 'inbox',
      },
      {
        key: 'TICKET_REPLY_DRAFT',
        name: 'Borrador Respuesta Ticket',
        description: 'Genera respuesta profesional para un ticket',
        scopeType: 'BUILDING' as const,
        requiredPermissions: ['tickets.write'],
        promptUser: `Necesito responder este ticket:
Título: {{ticket_title}}
Descripción: {{ticket_description}}
{{last_comment}}

Genera una respuesta profesional y respetuosa.`,
        category: 'tickets',
      },
      {
        key: 'COMMUNICATION_DRAFT_GENERAL',
        name: 'Borrador Comunicado',
        description: 'Crea comunicado para residentes',
        scopeType: 'BUILDING' as const,
        requiredPermissions: ['communications.publish'],
        promptUser: `Necesito redactar un comunicado sobre:
{{topic}}

{{optional_details}}

Genera un comunicado claro, profesional y conciso.`,
        category: 'communications',
      },
      {
        key: 'COMMUNICATION_PAYMENT_REMINDER',
        name: 'Recordatorio Pago',
        description: 'Recordatorio de pago respetuoso',
        scopeType: 'BUILDING' as const,
        requiredPermissions: ['communications.publish'],
        promptUser: `Necesito recordar el pago de expensas:
Vencimiento: {{due_date}}
Monto: {{amount}}
Instrucciones: {{payment_instructions}}

Genera un recordatorio respetuoso y motivador.`,
        category: 'communications',
      },
      {
        key: 'FINANCE_EXPLAIN_BALANCE',
        name: 'Explicar Balance',
        description: 'Explica balance a residente en términos simples',
        scopeType: 'UNIT' as const,
        requiredPermissions: ['finance.read'],
        promptUser: `Un residente pregunta sobre su balance:
Deuda actual: {{balance}}
Últimos pagos: {{recent_payments}}
Período: {{period}}

Explica en términos simples y proporciona pasos claros.`,
        category: 'finance',
      },
    ];

    for (const template of templates) {
      await this.prisma.aiTemplate.upsert({
        where: { key: template.key },
        create: {
          key: template.key,
          name: template.name,
          description: template.description,
          scopeType: template.scopeType,
          promptUser: template.promptUser,
          category: template.category,
          tenantId: tenantId || null,
          requiredPermissions: JSON.stringify(template.requiredPermissions),
        },
        update: {
          promptUser: template.promptUser,
          requiredPermissions: JSON.stringify(template.requiredPermissions),
        },
      });
    }
  }
}
