import { Injectable } from '@nestjs/common';
import type { IntentFilters } from './intent.types';

export interface FilterCoverageAnalysis {
  complete: boolean;
  detectedSignals: string[];
  missingFields: string[];
}

@Injectable()
export class FilterCoverageValidator {
  analyze(message: string, filters: IntentFilters): FilterCoverageAnalysis {
    const normalized = this.normalize(message);
    const detectedSignals: string[] = [];
    const missingFields: string[] = [];

    if (this.detectsPeriod(normalized)) {
      detectedSignals.push('period');
      if (!filters.period) {
        missingFields.push('period');
      }
    }

    if (this.detectsPaymentMethod(normalized)) {
      detectedSignals.push('method');
      if (!filters.method) {
        missingFields.push('method');
      }
    }

    if (this.detectsStatus(normalized)) {
      detectedSignals.push('status');
      if (!filters.status) {
        missingFields.push('status');
      }
    }

    if (this.detectsMinAge(normalized)) {
      detectedSignals.push('minAgeDays');
      if (typeof filters.minAgeDays !== 'number') {
        missingFields.push('minAgeDays');
      }
    }

    if (this.detectsAmountComparison(normalized)) {
      detectedSignals.push('amountComparison');
      if (
        typeof filters.minAmount !== 'number' &&
        typeof filters.maxAmount !== 'number' &&
        typeof filters.minDebt !== 'number'
      ) {
        missingFields.push('minAmount_or_maxAmount_or_minDebt');
      }
    }

    return {
      complete: missingFields.length === 0,
      detectedSignals,
      missingFields,
    };
  }

  private detectsPeriod(value: string): boolean {
    return (
      /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/.test(value) ||
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(value) ||
      /\b(este mes|mes actual|mes pasado|ultimo mes|último mes|hoy|ayer)\b/.test(value) ||
      /\b\d{4}-\d{2}\b/.test(value) ||
      /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/.test(value)
    );
  }

  private detectsAmountComparison(value: string): boolean {
    return (
      /\b(mayor(?:es)?\s+(?:que|a)|mas(?: de)?|más(?: de)?)\s+\$?\s*\d+([.,]\d+)?\b/.test(value) ||
      /\b(menor(?:es)?\s+(?:que|a)|menos(?: de)?)\s+\$?\s*\d+([.,]\d+)?\b/.test(value)
    );
  }

  private detectsPaymentMethod(value: string): boolean {
    return /\b(transferencia|transfer|efectivo|cash|tarjeta|card|debito|d[eé]bito|credito|cr[eé]dito)\b/.test(value);
  }

  private detectsStatus(value: string): boolean {
    return /\b(abierto|open|cerrado|closed|pendiente|pending|aprobado|approved|reconciliado|reconciled)\b/.test(value);
  }

  private detectsMinAge(value: string): boolean {
    return /\b(hace\s+m[aá]s\s+de\s+\d+\s+d[ií]as?|m[aá]s\s+de\s+\d+\s+d[ií]as?)\b/.test(value);
  }

  private normalize(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }
}
