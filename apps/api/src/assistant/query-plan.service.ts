import { Injectable } from '@nestjs/common';
import { AssistantQueryParser } from './query-parser/assistant-query-parser';
import { AssistantSemanticLayerService } from './semantic-layer.service';
import type { AssistantQueryIntent, AssistantQueryPlan } from './query-plan.types';

@Injectable()
export class AssistantQueryPlanService {
  private readonly parser = new AssistantQueryParser();

  constructor(private readonly semanticLayer: AssistantSemanticLayerService) {}

  /**
   * Convert a user message into a deterministic, allowlisted QueryPlan.
   */
  createPlan(message: string): AssistantQueryPlan | null {
    const normalized = this.normalize(message);
    const unitToken = this.parser.parseUnitReference(message);

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
          buildingAlias: unitToken.buildingAlias,
          buildingName: unitToken.buildingName,
        },
        confidence: 0.92,
        source: 'deterministic_rules',
      };
    }

    const buildingToken = this.parser.extractBuildingToken(message);
    if (!buildingToken) {
      return null;
    }

    const buildingIntent = this.pickBuildingIntent(normalized);
    if (!buildingIntent) {
      return null;
    }

    const definition = this.semanticLayer.getDefinition(buildingIntent);
    return {
      ...definition,
      executor: buildingIntent,
      filters: { buildingToken },
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
    if (this.hasAny(normalized, ['moroso', 'morosos', 'morosa', 'morosas', 'deudor', 'deudores', 'top deudores', 'ranking de deuda', 'atrasados', 'impagos'])) {
      return 'building_delinquents';
    }
    if (this.hasAny(normalized, ['deuda', 'deudas', 'saldo', 'adeuda', 'cuanto debe', 'cuanto se debe', 'estado de cuenta'])) {
      return 'building_debt';
    }
    if (this.hasAny(normalized, ['documento', 'documentos', 'archivo', 'archivos', 'pdf', 'comprobante', 'acta', 'planilla'])) {
      return 'building_documents';
    }
    if (this.hasAny(normalized, ['ticket', 'tickets', 'reclamo', 'reclamos', 'problema', 'incidente'])) {
      return 'building_tickets';
    }
    if (this.hasAny(normalized, ['pago', 'pagos', 'transferencia', 'recibo', 'cobranza', 'cobranzas', 'cobro', 'cobros'])) {
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

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
