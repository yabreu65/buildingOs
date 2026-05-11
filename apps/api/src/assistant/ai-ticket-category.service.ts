import { Injectable, Logger } from '@nestjs/common';
import { TicketCategory, TicketPriority } from '@prisma/client';

/**
 * AI-powered automatic ticket categorization service
 *
 * Intelligent ticket classification using keyword-based rules.
 * Fast, deterministic, and doesn't depend on external LLM services.
 *
 * Features:
 * - Suggests category and priority based on ticket title + description
 * - Runs in background (fire-and-forget) - never blocks user response
 * - Graceful error handling - if categorization fails, ticket still created normally
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

interface CategoryRule {
  keywords: string[];
  category: TicketCategory;
  priority: TicketPriority;
  reasoning: string;
}

@Injectable()
export class AiTicketCategoryService {
  private readonly logger = new Logger(AiTicketCategoryService.name);

  private readonly rules: CategoryRule[] = [
    // REPAIR - Plumbing (highest priority)
    {
      keywords: ['cañería', 'cañeria', 'plomería', 'plomeria', 'fuga', 'agua', 'inundación', 'inundacion', 'lavamanos', 'lavabo', 'baño', 'bano', 'ducha', 'tubería', 'tuberia', 'desagüe', 'desague', 'grifo', 'llave de paso'],
      category: 'REPAIR',
      priority: 'HIGH',
      reasoning: 'Problema de plomería que requiere reparación urgente',
    },
    // REPAIR - Electrical
    {
      keywords: ['electricidad', 'eléctrico', 'electrico', 'luz', 'apagón', 'apagon', 'cortocircuito', 'enchufe', 'tomacorriente', 'cable', 'cableado', 'transformador'],
      category: 'REPAIR',
      priority: 'HIGH',
      reasoning: 'Problema eléctrico que requiere reparación urgente',
    },
    // REPAIR - General
    {
      keywords: ['roto', 'rota', 'rompió', 'rompio', 'quebrado', 'quebrada', 'dañado', 'dañada', 'dañó', 'daño', 'falla', 'falló', 'fallo', 'no funciona', 'descompuesto', 'descompuesta'],
      category: 'REPAIR',
      priority: 'MEDIUM',
      reasoning: 'Equipo o elemento que necesita reparación',
    },
    // MAINTENANCE
    {
      keywords: ['mantenimiento', 'pintura', 'pintar', 'revision', 'revisión', 'preventivo', 'inspección', 'inspeccion', 'caldera', 'ascensor', 'aire acondicionado', 'filtro'],
      category: 'MAINTENANCE',
      priority: 'MEDIUM',
      reasoning: 'Trabajo de mantenimiento preventivo o rutinario',
    },
    // CLEANING
    {
      keywords: ['limpieza', 'limpiar', 'sucio', 'basura', 'desinfección', 'desinfeccion', 'fumigación', 'fumigacion', 'plaga', 'pesticida', 'higiene', 'residuos'],
      category: 'CLEANING',
      priority: 'MEDIUM',
      reasoning: 'Tarea relacionada con limpieza o saneamiento',
    },
    // COMPLAINT
    {
      keywords: ['ruido', 'molestia', 'molesto', 'molesta', 'queja', 'reclamo', 'vecino', 'vecina', 'comportamiento', 'escándalo', 'escandalo', 'música', 'musica', 'fiesta'],
      category: 'COMPLAINT',
      priority: 'MEDIUM',
      reasoning: 'Queja o reclamo entre residentes',
    },
    // SAFETY
    {
      keywords: ['seguridad', 'peligro', 'peligrosa', 'peligroso', 'riesgo', 'incendio', 'fuego', 'escape', 'gas', 'estructural', 'derrumbe', 'robo', 'intruso', 'emergencia'],
      category: 'SAFETY',
      priority: 'URGENT',
      reasoning: 'Riesgo de seguridad que requiere atención inmediata',
    },
    // BILLING
    {
      keywords: ['pago', 'cobro', 'expensa', 'expensas', 'factura', 'facturación', 'facturacion', 'deuda', 'mora', 'precio', 'tarifa', 'recibo', 'cuota', 'financiero'],
      category: 'BILLING',
      priority: 'LOW',
      reasoning: 'Asunto relacionado con pagos o finanzas',
    },
  ];

  /**
   * Suggest category and priority for a ticket based on title + description
   * Uses keyword-based rules for fast, deterministic classification
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
      this.logger.debug(
        `[AI Categorization] Starting for ticket: "${title}" (tenant: ${tenantId})`,
      );

      const text = `${title} ${description}`.toLowerCase();
      
      // Find matching rules
      let bestMatch: CategoryRule | null = null;
      let maxMatches = 0;
      
      for (const rule of this.rules) {
        const matches = rule.keywords.filter(keyword => text.includes(keyword)).length;
        if (matches > maxMatches) {
          maxMatches = matches;
          bestMatch = rule;
        }
      }

      if (!bestMatch || maxMatches === 0) {
        this.logger.debug(
          `[AI Categorization] No matching keywords found for ticket: "${title}", falling back to OTHER`,
        );
        return {
          category: 'OTHER',
          priority: 'MEDIUM',
          confidence: 30,
          reasoning: 'No se encontraron palabras clave específicas para categorizar',
        };
      }

      const confidence = Math.min(100, 50 + (maxMatches * 15));

      this.logger.debug(
        `[AI Categorization] Success: category=${bestMatch.category}, priority=${bestMatch.priority}, confidence=${confidence}%, matches=${maxMatches}`,
      );

      return {
        category: bestMatch.category,
        priority: bestMatch.priority,
        confidence,
        reasoning: bestMatch.reasoning,
      };
    } catch (error) {
      // Graceful error handling - never fail the ticket creation
      this.logger.error(
        `[AI Categorization] Error for ticket "${title}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
