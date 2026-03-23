import { Injectable, Logger } from '@nestjs/common';
import { TicketCategory, TicketPriority } from '@prisma/client';
import { AssistantService } from './assistant.service';

/**
 * FASE 2: AI-powered automatic ticket categorization service
 *
 * Intelligent ticket classification using AI (LLM).
 *
 * Features:
 * - Suggests category and priority based on ticket title + description
 * - Runs in background (fire-and-forget) - never blocks user response
 * - Graceful error handling - if AI fails, ticket still created normally
 * - Non-blocking: User sees ticket immediately, AI updates run async
 * - Budget: Does NOT consume user AI budget (backend operation)
 * - Logging: All categorization attempts logged for debugging
 *
 * Integration:
 * - Called from TicketsService.create() after ticket is persisted
 * - Only runs if user didn't explicitly provide category/priority
 * - Updates ticket with ai* fields (aiSuggestedCategory, aiCategorySuggestion)
 *
 * Categories (7):
 * - MAINTENANCE: Routine maintenance (painting, inspections, preventive)
 * - REPAIR: Things broken needing fixing (plumbing, electrical, doors)
 * - CLEANING: Sanitation/cleaning work (common areas, trash, pest control)
 * - COMPLAINT: Resident complaints (noise, behavior, disturbances)
 * - SAFETY: Safety hazards (fire risks, structural, security)
 * - BILLING: Financial matters (payments, invoices, disputes)
 * - OTHER: Everything else
 *
 * Priority Levels (4):
 * - LOW: Non-urgent, can wait 2+ weeks
 * - MEDIUM: Standard, should be done within a week
 * - HIGH: Should be done within 2-3 days
 * - URGENT: Safety or critical service down, must address immediately
 */

export interface TicketCategorySuggestion {
  category: TicketCategory;
  priority: TicketPriority;
  confidence: number; // 0-100
  reasoning: string; // Why AI chose this
}

@Injectable()
export class AiTicketCategoryService {
  private readonly logger = new Logger(AiTicketCategoryService.name);

  constructor(private assistantService: AssistantService) {}

  /**
   * Suggest category and priority for a ticket based on title + description
   * This NEVER consumes AI budget - it's an internal backend operation
   *
   * @param tenantId - Tenant owning the ticket
   * @param title - Ticket title
   * @param description - Ticket description
   * @param buildingId - Optional: Building context
   * @param unitId - Optional: Unit context
   * @returns TicketCategorySuggestion or null on error
   */
  async suggestCategory(
    tenantId: string,
    title: string,
    description: string,
    buildingId?: string,
    unitId?: string,
  ): Promise<TicketCategorySuggestion | null> {
    try {
      // Build the AI prompt
      const prompt = this.buildPrompt(title, description);

      this.logger.debug(
        `[AI Categorization] Starting for ticket: "${title}" (tenant: ${tenantId})`,
      );

      // Call AssistantService's internal chat method
      // We use a special internal request that doesn't consume user budget
      const response = await this.assistantService.chat(
        tenantId,
        'system', // Special system user for internal operations
        'system', // Special system membership
        {
          message: prompt,
          page: 'internal:ticket-categorization',
          buildingId,
          unitId,
        },
        ['SUPER_ADMIN'], // For classification, we use admin scope
      );

      // Parse the response to extract category, priority, confidence
      const suggestion = this.parseResponse(response.answer);

      if (!suggestion) {
        this.logger.warn(
          `[AI Categorization] Failed to parse response for ticket: "${title}"`,
        );
        return null;
      }

      this.logger.debug(
        `[AI Categorization] Success: category=${suggestion.category}, priority=${suggestion.priority}, confidence=${suggestion.confidence}%`,
      );

      return suggestion;
    } catch (error) {
      // Graceful error handling - never fail the ticket creation
      this.logger.error(
        `[AI Categorization] Error for ticket "${title}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Build the AI prompt for ticket categorization
   * Prompt is designed for fast classification with clear structure
   */
  private buildPrompt(title: string, description: string): string {
    return `You are a facility management AI assistant. Analyze this ticket and provide a category and priority.

TICKET:
Title: ${title}
Description: ${description}

RESPOND WITH THIS EXACT JSON FORMAT (no markdown, no explanation):
{
  "category": "MAINTENANCE|REPAIR|CLEANING|COMPLAINT|SAFETY|BILLING|OTHER",
  "priority": "LOW|MEDIUM|HIGH|URGENT",
  "confidence": 75,
  "reasoning": "Brief reason for this categorization"
}

Categories:
- MAINTENANCE: Routine maintenance work (painting, inspection, preventive maintenance)
- REPAIR: Something is broken and needs fixing (plumbing, electrical, doors, fixtures)
- CLEANING: Cleaning or sanitation related (common areas, trash, pest control)
- COMPLAINT: Noise, behavior, disturbance complaints from residents
- SAFETY: Safety hazards (fire risks, structural issues, security)
- BILLING: Payment, invoicing, or financial disputes
- OTHER: Everything else

Priority:
- LOW: Non-urgent, can wait 2+ weeks
- MEDIUM: Standard work, should be done within a week
- HIGH: Should be done within 2-3 days
- URGENT: Safety hazard or critical service down, must address immediately`;
  }

  /**
   * Parse the AI response to extract structured suggestion
   */
  private parseResponse(response: string): TicketCategorySuggestion | null {
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = response;
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr);

      // Validate category
      const validCategories: TicketCategory[] = [
        'MAINTENANCE',
        'REPAIR',
        'CLEANING',
        'COMPLAINT',
        'SAFETY',
        'BILLING',
        'OTHER',
      ];
      if (!validCategories.includes(parsed.category)) {
        this.logger.warn(
          `Invalid category from AI: ${parsed.category}, falling back to OTHER`,
        );
        parsed.category = 'OTHER';
      }

      // Validate priority
      const validPriorities: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
      if (!validPriorities.includes(parsed.priority)) {
        this.logger.warn(
          `Invalid priority from AI: ${parsed.priority}, falling back to MEDIUM`,
        );
        parsed.priority = 'MEDIUM';
      }

      // Validate confidence (0-100)
      const confidence = Math.min(100, Math.max(0, parseInt(parsed.confidence, 10) || 50));

      // Validate reasoning is a string
      const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided';

      return {
        category: parsed.category as TicketCategory,
        priority: parsed.priority as TicketPriority,
        confidence,
        reasoning,
      };
    } catch (error) {
      this.logger.error(
        `[Parse Response] Failed to parse AI response: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
