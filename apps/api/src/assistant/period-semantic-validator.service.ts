import { Injectable } from '@nestjs/common';
import type {
  CanonicalFinancePeriod,
  PeriodValidationResult,
  RelativeRangeMode,
} from './finance-period.types';

export interface PeriodSemanticValidationInput {
  period: CanonicalFinancePeriod | null;
  missingFields?: string[];
}

@Injectable()
export class PeriodSemanticValidatorService {
  validate(input: PeriodSemanticValidationInput): PeriodValidationResult {
    if (!input.period || input.period.kind === 'unknown') {
      return {
        valid: false,
        requiresClarification: true,
        missingFields: ['period'],
        clarificationMessage: '¿Qué período financiero querés consultar?',
        normalizedPeriod: input.period,
      };
    }

    if (input.period.kind === 'relative_range') {
      return this.validateRelativeRange(input.period, input.missingFields);
    }

    if (input.period.kind === 'month_range') {
      return this.validateMonthRange(input.period, input.missingFields);
    }

    return {
      valid: true,
      requiresClarification: false,
      missingFields: [],
      normalizedPeriod: input.period,
    };
  }

  private validateRelativeRange(
    period: CanonicalFinancePeriod,
    missingFields: string[] = [],
  ): PeriodValidationResult {
    const normalizedMissingFields = this.normalizeMissingFields(period, missingFields);
    const hasMode = this.isFilledMode(period.mode);

    if (!hasMode) {
      return {
        valid: false,
        requiresClarification: true,
        missingFields: normalizedMissingFields.length > 0 ? normalizedMissingFields : ['period.mode'],
        clarificationMessage: this.buildRelativeRangeClarificationMessage(period.amount),
        normalizedPeriod: period,
      };
    }

    return {
      valid: true,
      requiresClarification: false,
      missingFields: [],
      normalizedPeriod: period,
    };
  }

  private validateMonthRange(
    period: CanonicalFinancePeriod,
    missingFields: string[] = [],
  ): PeriodValidationResult {
    const normalizedMissingFields = this.normalizeMonthRangeMissingFields(period, missingFields);
    const hasStart = this.isFilledMonth(period.startMonth) && this.isFilledYear(period.startYear);
    const hasEnd = this.isFilledMonth(period.endMonth) && this.isFilledYear(period.endYear);

    if (!hasStart || !hasEnd) {
      return {
        valid: false,
        requiresClarification: true,
        missingFields: normalizedMissingFields.length > 0 ? normalizedMissingFields : ['period.startMonth', 'period.endMonth'],
        clarificationMessage: '¿Qué rango de meses querés consultar?',
        normalizedPeriod: period,
      };
    }

    return {
      valid: true,
      requiresClarification: false,
      missingFields: [],
      normalizedPeriod: period,
    };
  }

  private normalizeMissingFields(
    period: CanonicalFinancePeriod,
    missingFields: string[],
  ): string[] {
    const normalized = new Set<string>();
    for (const field of missingFields) {
      if (field === 'startMonth' || field === 'endMonth' || field === 'period.mode') {
        normalized.add('period.mode');
        continue;
      }
      normalized.add(this.prefixField(field));
    }

    if (normalized.size === 0 && period.kind === 'relative_range' && !this.isFilledMode(period.mode)) {
      normalized.add('period.mode');
    }

    return Array.from(normalized);
  }

  private normalizeMonthRangeMissingFields(
    period: CanonicalFinancePeriod,
    missingFields: string[],
  ): string[] {
    const normalized = new Set<string>();
    for (const field of missingFields) {
      if (field === 'period.mode') {
        normalized.add('period.mode');
        continue;
      }
      normalized.add(this.prefixField(field));
    }

    if (normalized.size === 0 && (!this.isFilledMonth(period.startMonth) || !this.isFilledMonth(period.endMonth))) {
      normalized.add('period.startMonth');
      normalized.add('period.endMonth');
    }

    return Array.from(normalized);
  }

  private buildRelativeRangeClarificationMessage(amount: number | null): string {
    const amountText = amount ? `${amount}` : 'los últimos';
    return `¿Querés incluir el mes actual o consultar solo los últimos ${amountText} meses cerrados?`;
  }

  private prefixField(field: string): string {
    if (field.startsWith('period.')) {
      return field;
    }

    return `period.${field}`;
  }

  private isFilledMode(mode: RelativeRangeMode | null): boolean {
    return mode === 'including_current' || mode === 'closed_months';
  }

  private isFilledMonth(value: number | null): boolean {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12;
  }

  private isFilledYear(value: number | null): boolean {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1900;
  }
}
