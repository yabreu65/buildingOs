import { Injectable } from '@nestjs/common';
import { AssistantDebtIntentInterpreter } from './debt-intent-interpreter';
import { AssistantQueryParser } from './query-parser/assistant-query-parser';
import { AssistantSemanticLayerService } from './semantic-layer.service';
import type { AssistantQueryIntent, AssistantQueryPlan } from './query-plan.types';

@Injectable()
export class AssistantQueryPlanService {
  private readonly parser = new AssistantQueryParser();
  private readonly debtInterpreter = new AssistantDebtIntentInterpreter();

  constructor(private readonly semanticLayer: AssistantSemanticLayerService) {}

  /**
   * Convert a user message into a deterministic, allowlisted QueryPlan.
   */
  createPlan(message: string): AssistantQueryPlan | null {
    const normalized = this.normalize(message);
    if (this.hasWriteIntentSignal(normalized)) {
      return null;
    }

    const parsedUnitToken = this.parser.parseUnitReference(message);
    const buildingToken = this.parser.extractBuildingToken(message);
    const extractedFilters = this.extractCommonFilters(normalized);
    const personName = this.extractPersonName(message, normalized);
    const referencesSomeone = this.hasAny(normalized, ['alguien', 'persona', 'quien', 'quién']);
    const debtInterpretation = this.debtInterpreter.interpret(message);
    const tenantDebtPeriod = this.extractTenantDebtPeriod(normalized);

    const hasExplicitUnitSyntax =
      /\b(unidad|apartamento|departamento|depto|apto|local|cochera|garage)\b/.test(normalized) ||
      /\b[a-z]{1,3}-\d{3,4}\b/.test(normalized);

    const unitToken =
      parsedUnitToken &&
      !(
        (typeof extractedFilters.minAmount === 'number' || typeof extractedFilters.minDebt === 'number') &&
        referencesSomeone &&
        !hasExplicitUnitSyntax
      ) &&
      !(
        Boolean(buildingToken) &&
        typeof extractedFilters.period === 'string' &&
        /^\d{4}$/.test(parsedUnitToken.unitCodeRaw ?? parsedUnitToken.unitCode)
      )
        ? parsedUnitToken
        : null;

    if (unitToken) {
      const unitIntent = this.pickUnitIntent(normalized);
      if (!unitIntent) {
        return null;
      }
      const definition = this.semanticLayer.getDefinition(unitIntent);
      return {
        ...definition,
        executor: unitIntent,
        filters: {
          unitCode: unitToken.unitCode,
          unitCodeRaw: unitToken.unitCodeRaw,
          buildingAlias: unitToken.buildingAlias,
          buildingName: unitToken.buildingName,
          ...extractedFilters,
        },
        confidence: 0.92,
        source: 'deterministic_rules',
      };
    }

    if (debtInterpretation.scope === 'tenant') {
      const definition = this.semanticLayer.getDefinition('tenant_debt');
      return {
        ...definition,
        executor: 'tenant_debt',
        filters: {
          ...extractedFilters,
          ...(tenantDebtPeriod ? { period: tenantDebtPeriod } : {}),
        },
        confidence: 0.9,
        source: 'deterministic_rules',
      };
    }

    if (debtInterpretation.scope === 'ambiguous' && debtInterpretation.hasDebtSignal) {
      return null;
    }

    const buildingIntent = this.pickBuildingIntent(normalized);
    if (!buildingIntent && personName && this.hasAny(normalized, ['debe', 'deuda', 'saldo', 'adeuda'])) {
      const definition = this.semanticLayer.getDefinition('unit_debt');
      return {
        ...definition,
        executor: 'unit_debt',
        filters: {
          personName,
          ...extractedFilters,
        },
        confidence: 0.84,
        source: 'deterministic_rules',
      };
    }
    if (!buildingIntent) {
      return null;
    }

    // Intent detected but no explicit building – return plan anyway.
    // chatV2 will resolve the building from request.buildingId or context.
    if (!buildingToken) {
      const definition = this.semanticLayer.getDefinition(buildingIntent);
      return {
        ...definition,
        executor: buildingIntent,
        filters: { ...extractedFilters },
        confidence: 0.85,
        source: 'deterministic_rules',
      };
    }

    const definition = this.semanticLayer.getDefinition(buildingIntent);
    return {
      ...definition,
      executor: buildingIntent,
      filters: { buildingToken, buildingAlias: buildingToken, ...extractedFilters },
      confidence: 0.9,
      source: 'deterministic_rules',
    };
  }

  private pickUnitIntent(normalized: string): AssistantQueryIntent | null {
    if (this.hasAny(normalized, ['residente', 'ocupante', 'inquilino', 'propietario', 'vive', 'habita', 'reside'])) {
      return 'unit_residents';
    }
    if (this.hasAny(normalized, ['debe', 'deuda', 'saldo', 'adeuda', 'estado de cuenta', 'al dia'])) {
      return 'unit_debt';
    }
    if (this.hasAny(normalized, ['documento', 'documentos', 'archivo', 'archivos', 'pdf', 'comprobante', 'acta', 'planilla'])) {
      return 'unit_documents';
    }
    if (this.hasAny(normalized, ['ticket', 'tickets', 'reclamo', 'problema', 'averia', 'falla', 'incidente'])) {
      return 'unit_tickets';
    }
    if (this.hasAny(normalized, ['pago', 'pagos', 'transferencia', 'recibo', 'movimiento', 'transaccion', 'abono', 'cobro'])) {
      return 'unit_payments';
    }
    return null;
  }

  private pickBuildingIntent(normalized: string): AssistantQueryIntent | null {
    const referencesSomeone = this.hasAny(normalized, ['alguien', 'algun', 'algun', 'persona', 'quien']);
    const asksDebtComparison = /(?:mayor(?:es)?\s+(?:que|a)|mas(?: de)?|más(?: de)?|menor(?:es)?\s+(?:que|a)|menos(?: de)?)\s+\$?\s*\d+/.test(normalized);
    if (referencesSomeone && (asksDebtComparison || this.hasAny(normalized, ['deuda', 'debe', 'adeuda']))) {
      return 'building_delinquents';
    }

    if (this.hasAny(normalized, ['moroso', 'morosos', 'morosa', 'morosas', 'deudor', 'deudores', 'top deudores', 'ranking de deuda', 'atrasados', 'impagos', 'tardando en pagar', 'no ha pagado', 'no estan al dia', 'no esta al dia', 'mantenimiento pendiente', 'pagar mantenimiento'])) {
      return 'building_delinquents';
    }
    if (this.hasAny(normalized, ['deuda', 'deudas', 'saldo', 'adeuda', 'cuanto debe', 'cuanto se debe', 'estado de cuenta', 'tardando en pagar'])) {
      return 'building_debt';
    }
    if (this.hasAny(normalized, ['documento', 'documentos', 'archivo', 'archivos', 'pdf', 'comprobante', 'acta', 'planilla'])) {
      return 'building_documents';
    }
    if (this.hasAny(normalized, ['ticket', 'tickets', 'reclamo', 'reclamos', 'problema', 'incidente'])) {
      return 'building_tickets';
    }
    if (this.hasAny(normalized, ['pago', 'pagos', 'transferencia', 'recibo', 'cobranza', 'cobranzas', 'cobro', 'cobros', 'banco', 'plata', 'ingreso', 'ingresos'])) {
      return 'building_payments';
    }
    if (this.hasAny(normalized, ['estadistica', 'estadisticas', 'resumen', 'estado del edificio', 'situacion', 'cuantas unidades', 'datos del edificio'])) {
      return 'building_stats';
    }
    return null;
  }

  private hasAny(value: string, needles: string[]): boolean {
    return needles.some((needle) => value.includes(needle));
  }

  private hasWriteIntentSignal(normalized: string): boolean {
    const writeVerbPattern = /\b(anular|cancelar|crear|editar|eliminar|borrar|registrar|cargar|subir|marcar|actualizar|modificar|cambiar|dar de baja|agregar|anadir)\b/;
    const writeTargetPattern = /\b(pago|pagos|gasto|gastos|egreso|egresos|comprobante|comprobantes|recibo|recibos|pagado|pagada|pagados|pagadas|deuda|deudas|saldo|saldos|cobro|cobros|cobranza|cobranzas|ticket|tickets|reclamo|reclamos|documento|documentos|unidad|unidades|edificio|edificios|moroso|morosos|administracion|condominio)\b/;

    if (writeVerbPattern.test(normalized) && writeTargetPattern.test(normalized)) {
      return true;
    }

    if (/\bmarcar\b/.test(normalized) && /\bpagad[oa]s?\b/.test(normalized)) {
      return true;
    }

    if (/\b(anular|cancelar)\b/.test(normalized) && /\b(pago|pagos|comprobante|comprobantes)\b/.test(normalized)) {
      return true;
    }

    if (/\b(crear|editar|eliminar|borrar|registrar|cargar|subir)\b/.test(normalized) && /\b(gasto|gastos|egreso|egresos|pago|pagos|comprobante|comprobantes)\b/.test(normalized)) {
      return true;
    }

    return false;
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private extractCommonFilters(normalized: string): AssistantQueryPlan['filters'] {
    const filters: AssistantQueryPlan['filters'] = {};

    const period = this.extractPeriod(normalized);
    if (period) {
      filters.period = period;
    }

    const status = this.extractStatus(normalized);
    if (status) {
      filters.status = status;
    }

    const method = this.extractMethod(normalized);
    if (method) {
      filters.method = method;
    }

    const minAgeDays = this.extractMinAgeDays(normalized);
    if (typeof minAgeDays === 'number') {
      filters.minAgeDays = minAgeDays;
    }

    const amountFilters = this.extractAmountFilters(normalized);
    return {
      ...filters,
      ...amountFilters,
    };
  }

  private extractTenantDebtPeriod(normalized: string): string | undefined {
    if (normalized.includes('este mes') || normalized.includes('mes actual') || normalized.includes('del mes actual')) {
      return 'current_month';
    }

    if (/acumulad[ao]s?/.test(normalized) || /hist[oó]ric[ao]s?/.test(normalized) || /\btoda\b/.test(normalized) || /\btodo\b/.test(normalized)) {
      return 'accumulated';
    }

    return undefined;
  }

  private extractPeriod(normalized: string): string | undefined {
    const direct = normalized.match(/\b(\d{4}-\d{2})\b/);
    if (direct?.[1]) {
      return direct[1];
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const monthMap: Record<string, number> = {
      enero: 1,
      febrero: 2,
      marzo: 3,
      abril: 4,
      mayo: 5,
      junio: 6,
      julio: 7,
      agosto: 8,
      septiembre: 9,
      setiembre: 9,
      octubre: 10,
      noviembre: 11,
      diciembre: 12,
      january: 1,
      february: 2,
      march: 3,
      april: 4,
      may_en: 5,
      june: 6,
      july: 7,
      august: 8,
      september: 9,
      october: 10,
      november: 11,
      december: 12,
    };

    const explicitMonthYear = normalized.match(
      /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/,
    );
    if (explicitMonthYear?.[1] && explicitMonthYear?.[2]) {
      const rawMonthToken = explicitMonthYear[1];
      const monthToken = rawMonthToken === 'may' ? 'may_en' : rawMonthToken;
      const month = monthMap[monthToken];
      if (month) {
        return `${explicitMonthYear[2]}-${String(month).padStart(2, '0')}`;
      }
    }

    for (const [token, month] of Object.entries(monthMap)) {
      const needle = token === 'may_en' ? 'may' : token;
      if (new RegExp(`\\b${needle}\\b`).test(normalized)) {
        return `${currentYear}-${String(month).padStart(2, '0')}`;
      }
    }

    if (normalized.includes('este mes') || normalized.includes('mes actual')) {
      return `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    if (normalized.includes('mes pasado') || normalized.includes('ultimo mes') || normalized.includes('último mes')) {
      const previous = new Date(currentYear, now.getMonth() - 1, 1);
      return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
    }

    return undefined;
  }

  private extractMethod(normalized: string): string | undefined {
    if (/\btransferencia|transfer\b/.test(normalized)) return 'TRANSFER';
    if (/\bbanco|bancaria|bancario\b/.test(normalized)) return 'TRANSFER';
    if (/\befectivo|cash\b/.test(normalized)) return 'CASH';
    if (/\btarjeta|card\b/.test(normalized)) return 'CARD';
    return undefined;
  }

  private extractStatus(normalized: string): string | undefined {
    if (/\babierto|open\b/.test(normalized)) return 'OPEN';
    if (/\bcerrado|closed\b/.test(normalized)) return 'CLOSED';
    if (/\bpendiente|pending\b/.test(normalized)) return 'PENDING';
    if (/\baprobado|approved\b/.test(normalized)) return 'APPROVED';
    return undefined;
  }

  private extractMinAgeDays(normalized: string): number | undefined {
    const match = normalized.match(/hace\s+mas\s+de\s+(\d+)\s+dias?|mas\s+de\s+(\d+)\s+dias?/);
    if (!match) return undefined;
    const raw = match[1] || match[2];
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private extractAmountFilters(normalized: string): Pick<AssistantQueryPlan['filters'], 'minAmount' | 'maxAmount' | 'minDebt'> {
    const result: Pick<AssistantQueryPlan['filters'], 'minAmount' | 'maxAmount' | 'minDebt'> = {};

    const minMatch = normalized.match(/(?:mayor(?:es)?\s+(?:que|a)|mas(?: de)?|más(?: de)?)\s+\$?\s*(\d+(?:[.,]\d+)?)/);
    if (minMatch?.[1]) {
      const value = Number(minMatch[1].replace(',', '.'));
      if (Number.isFinite(value)) {
        result.minAmount = value;
        result.minDebt = value;
      }
    }

    const maxMatch = normalized.match(/(?:menor(?:es)?\s+(?:que|a)|menos(?: de)?)\s+\$?\s*(\d+(?:[.,]\d+)?)/);
    if (maxMatch?.[1]) {
      const value = Number(maxMatch[1].replace(',', '.'));
      if (Number.isFinite(value)) {
        result.maxAmount = value;
      }
    }

    return result;
  }

  private extractPersonName(message: string, normalized: string): string | undefined {
    if (!this.hasAny(normalized, ['debe', 'deuda', 'donde vive', 'vive'])) {
      return undefined;
    }

    const clean = message.replace(/[¿?.,!]/g, ' ').trim();
    const patterns = [
      /(?:debe|deuda de|donde vive|vive)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){1,2})/i,
      /^([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){1,2})\s+(?:debe|deuda)/i,
    ];

    for (const pattern of patterns) {
      const match = clean.match(pattern);
      if (match?.[1]) {
        const candidate = match[1].trim();
        if (!/\b(unidad|edificio|torre|bloque|pago|ticket|deuda)\b/i.test(candidate)) {
          return candidate;
        }
      }
    }
    return undefined;
  }
}
