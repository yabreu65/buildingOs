import { AssistantQueryParser, type UnitToken } from './query-parser/assistant-query-parser';

export type AssistantDebtScope = 'none' | 'ambiguous' | 'unit' | 'building' | 'tenant';

export interface AssistantDebtInterpretation {
  readonly scope: AssistantDebtScope;
  readonly hasDebtSignal: boolean;
  readonly hasGlobalSignal: boolean;
  readonly hasUnitSignal: boolean;
  readonly hasBuildingSignal: boolean;
  readonly normalized: string;
  readonly buildingToken?: string | null;
  readonly unitToken?: UnitToken | null;
  readonly reason: 'not_debt' | 'debt_without_scope' | 'unit_reference' | 'building_reference' | 'global_scope';
}

export class AssistantDebtIntentInterpreter {
  private readonly parser = new AssistantQueryParser();

  interpret(message: string): AssistantDebtInterpretation {
    const normalized = this.normalize(message);
    const unitToken = this.parser.parseUnitReference(message);
    const buildingToken = this.parser.extractBuildingToken(message);
    const genericBuildingToken = buildingToken ? this.isGenericBuildingToken(buildingToken) : false;

    const hasDebtSignal = this.hasAnyWord(normalized, [
      'deuda',
      'deudas',
      'debe',
      'deben',
      'adeuda',
      'adeudan',
      'saldo',
      'saldos',
      'morosidad',
      'moroso',
      'morosos',
      'pendiente',
      'pendientes',
    ]);

    if (!hasDebtSignal) {
      return {
        scope: 'none',
        hasDebtSignal: false,
        hasGlobalSignal: false,
        hasUnitSignal: false,
        hasBuildingSignal: false,
        normalized,
        buildingToken,
        unitToken,
        reason: 'not_debt',
      };
    }

    if (unitToken?.unitCode) {
      return {
        scope: 'unit',
        hasDebtSignal: true,
        hasGlobalSignal: false,
        hasUnitSignal: true,
        hasBuildingSignal: Boolean(buildingToken),
        normalized,
        buildingToken,
        unitToken,
        reason: 'unit_reference',
      };
    }

    const hasExplicitTenantSignal = this.hasExplicitTenantScope(normalized);
    if (hasExplicitTenantSignal) {
      return {
        scope: 'tenant',
        hasDebtSignal: true,
        hasGlobalSignal: true,
        hasUnitSignal: false,
        hasBuildingSignal: false,
        normalized,
        buildingToken,
        unitToken,
        reason: 'global_scope',
      };
    }

    if (buildingToken || genericBuildingToken || this.hasBuildingScope(normalized)) {
      return {
        scope: 'building',
        hasDebtSignal: true,
        hasGlobalSignal: false,
        hasUnitSignal: false,
        hasBuildingSignal: true,
        normalized,
        buildingToken,
        unitToken,
        reason: 'building_reference',
      };
    }

    if (this.hasStandaloneTenantScope(normalized)) {
      return {
        scope: 'tenant',
        hasDebtSignal: true,
        hasGlobalSignal: true,
        hasUnitSignal: false,
        hasBuildingSignal: false,
        normalized,
        buildingToken,
        unitToken,
        reason: 'global_scope',
      };
    }

    return {
      scope: 'ambiguous',
      hasDebtSignal: true,
      hasGlobalSignal: false,
      hasUnitSignal: false,
      hasBuildingSignal: false,
      normalized,
      buildingToken,
      unitToken,
      reason: 'debt_without_scope',
    };
  }

  private normalize(value: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private hasExplicitTenantScope(normalized: string): boolean {
    if (this.hasAnyWord(normalized, [
      'administracion',
      'administradora',
      'tenant',
      'consorcio',
      'comunidad',
      'global',
      'general',
    ])) {
      return true;
    }

    return (
      normalized.includes('todos los edificios') ||
      normalized.includes('todos los condominios') ||
      normalized.includes('todos los inmuebles') ||
      normalized.includes('todos los departamentos') ||
      normalized.includes('todos los apartamentos') ||
      normalized.includes('de todo')
    );
  }

  private isGenericBuildingToken(token: string): boolean {
    return this.hasAnyWord(token, ['completo', 'general', 'global', 'total', 'todos', 'administracion', 'administradora']);
  }

  private hasStandaloneTenantScope(normalized: string): boolean {
    return this.hasAnyWord(normalized, ['todo', 'todos', 'total']);
  }

  private hasBuildingScope(normalized: string): boolean {
    return this.hasAnyWord(normalized, [
      'condominio',
      'edificio',
      'building',
      'torre',
      'bloque',
      'sector',
      'pabellon',
      'pabellón',
      'residencia',
      'conjunto',
      'complejo',
    ]);
  }

  private hasAnyWord(normalized: string, words: string[]): boolean {
    return words.some((word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`).test(normalized);
    });
  }
}
