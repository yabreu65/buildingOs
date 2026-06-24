import { Injectable } from '@nestjs/common';
import type { CanonicalFinancePeriod, RelativeRangeMode } from './finance-period.types';

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

const NUMBER_WORDS: Record<string, number> = {
  uno: 1,
  una: 1,
  un: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
};

@Injectable()
export class PeriodNormalizerService {
  normalize(value: string): CanonicalFinancePeriod | null {
    const normalized = this.normalizeText(value);

    if (!normalized) {
      return null;
    }

    const relativeRange = this.parseRelativeRange(normalized);
    if (relativeRange) {
      return relativeRange;
    }

    const currentMonth = this.parseCurrentMonth(normalized);
    if (currentMonth) {
      return currentMonth;
    }

    const previousMonth = this.parsePreviousMonth(normalized);
    if (previousMonth) {
      return previousMonth;
    }

    const accumulated = this.parseAccumulated(normalized);
    if (accumulated) {
      return accumulated;
    }

    const yearToDate = this.parseYearToDate(normalized);
    if (yearToDate) {
      return yearToDate;
    }

    const namedMonth = this.parseNamedMonth(normalized);
    if (namedMonth) {
      return namedMonth;
    }

    const monthRange = this.parseMonthRange(normalized);
    if (monthRange) {
      return monthRange;
    }

    return {
      kind: 'unknown',
      amount: null,
      unit: null,
      mode: null,
      month: null,
      year: null,
      startMonth: null,
      startYear: null,
      endMonth: null,
      endYear: null,
    };
  }

  private parseCurrentMonth(normalized: string): CanonicalFinancePeriod | null {
    if (
      /\b(este mes|mes actual|mes en curso|mes corriente|del mes actual|del mes en curso|mes que esta corriendo)\b/.test(normalized) ||
      /\bdeuda del mes\b/.test(normalized) ||
      /\bdel mes\b/.test(normalized)
    ) {
      return {
        kind: 'current_month',
        amount: null,
        unit: null,
        mode: null,
        month: null,
        year: null,
        startMonth: null,
        startYear: null,
        endMonth: null,
        endYear: null,
      };
    }

    return null;
  }

  private parsePreviousMonth(normalized: string): CanonicalFinancePeriod | null {
    if (!/\b(mes pasado|ultimo mes|último mes)\b/.test(normalized)) {
      return null;
    }

    return {
      kind: 'previous_month',
      amount: null,
      unit: null,
      mode: null,
      month: null,
      year: null,
      startMonth: null,
      startYear: null,
      endMonth: null,
      endYear: null,
    };
  }

  private parseAccumulated(normalized: string): CanonicalFinancePeriod | null {
    if (!/\b(acumulad[ao]s?|historica|historico|hist[oó]ric[ao]s?|toda|todo)\b/.test(normalized)) {
      return null;
    }

    return {
      kind: 'accumulated',
      amount: null,
      unit: null,
      mode: null,
      month: null,
      year: null,
      startMonth: null,
      startYear: null,
      endMonth: null,
      endYear: null,
    };
  }

  private parseYearToDate(normalized: string): CanonicalFinancePeriod | null {
    if (!/\b(ano en curso|year to date|ytd)\b/.test(normalized)) {
      return null;
    }

    return {
      kind: 'year_to_date',
      amount: null,
      unit: null,
      mode: null,
      month: null,
      year: null,
      startMonth: null,
      startYear: null,
      endMonth: null,
      endYear: null,
    };
  }

  private parseNamedMonth(normalized: string): CanonicalFinancePeriod | null {
    const direct = normalized.match(/\b(\d{4})-(\d{2})\b/);
    if (direct?.[1] && direct?.[2]) {
      const year = Number(direct[1]);
      const month = Number(direct[2]);
      if (this.isValidMonth(month)) {
        return {
          kind: 'named_month',
          amount: null,
          unit: null,
          mode: null,
          month,
          year,
          startMonth: null,
          startYear: null,
          endMonth: null,
          endYear: null,
        };
      }
    }

    const match = normalized.match(
      /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(\d{4})\b/,
    );
    if (!match?.[1] || !match[2]) {
      return null;
    }

    const month = this.monthNameToNumber(match[1]);
    if (!month) {
      return null;
    }

    return {
      kind: 'named_month',
      amount: null,
      unit: null,
      mode: null,
      month,
      year: Number(match[2]),
      startMonth: null,
      startYear: null,
      endMonth: null,
      endYear: null,
    };
  }

  private parseRelativeRange(normalized: string): CanonicalFinancePeriod | null {
    const rangeMatch = normalized.match(
      /\b(?:los?\s+)?(?:ultimos?|últimos?)\s+([a-z0-9]+)\s+meses?\b/,
    );
    if (!rangeMatch?.[1]) {
      return null;
    }

    const amount = this.parseRangeAmount(rangeMatch[1]);
    if (amount === null) {
      return null;
    }

    const mode = this.parseRelativeRangeMode(normalized);
    return {
      kind: 'relative_range',
      amount,
      unit: 'month',
      mode,
      month: null,
      year: null,
      startMonth: null,
      startYear: null,
      endMonth: null,
      endYear: null,
    };
  }

  private parseMonthRange(normalized: string): CanonicalFinancePeriod | null {
    const betweenMatch = normalized.match(
      /\b(?:entre|de)\s+(.+?)\s+(?:y|a)\s+(.+?)\b/,
    );

    if (!betweenMatch?.[1] || !betweenMatch[2]) {
      return null;
    }

    const start = this.parseMonthToken(betweenMatch[1]);
    const end = this.parseMonthToken(betweenMatch[2]);

    if (!start || !end) {
      return null;
    }

    return {
      kind: 'month_range',
      amount: null,
      unit: null,
      mode: null,
      month: null,
      year: null,
      startMonth: start.month,
      startYear: start.year,
      endMonth: end.month,
      endYear: end.year,
    };
  }

  private parseMonthToken(rawToken: string): { month: number; year: number } | null {
    const token = this.normalizeText(rawToken);
    const direct = token.match(/\b(\d{4})-(\d{2})\b/);
    if (direct?.[1] && direct?.[2]) {
      const year = Number(direct[1]);
      const month = Number(direct[2]);
      if (this.isValidMonth(month)) {
        return { month, year };
      }
    }

    const named = token.match(
      /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(\d{4})\b/,
    );
    if (named?.[1] && named[2]) {
      const month = this.monthNameToNumber(named[1]);
      if (month) {
        return { month, year: Number(named[2]) };
      }
    }

    return null;
  }

  private parseRangeAmount(rawAmount: string): number | null {
    const numeric = Number(rawAmount);
    const rawWord = rawAmount.toLowerCase();
    const wordAmount = NUMBER_WORDS[rawWord];
    const value = Number.isFinite(numeric) ? numeric : wordAmount;

    if (value === undefined || value === null || Number.isNaN(value)) {
      return null;
    }

    return Math.min(12, Math.max(1, Math.trunc(value)));
  }

  private parseRelativeRangeMode(normalized: string): RelativeRangeMode {
    if (/\b(incluyendo este mes|incluye este mes|con este mes|incluyendo el mes actual|sumando este mes|mas este mes|más este mes)\b/.test(normalized)) {
      return 'including_current';
    }

    if (/\b(cerrados|solo meses cerrados|sin incluir este mes|sin contar este mes|solo los meses cerrados)\b/.test(normalized)) {
      return 'closed_months';
    }

    return 'unknown';
  }

  private monthNameToNumber(value: string): number | null {
    const normalized = value.toLowerCase();
    const index = MONTH_NAMES.findIndex((month) => month === normalized);
    return index >= 0 ? index + 1 : null;
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isValidMonth(month: number): boolean {
    return Number.isInteger(month) && month >= 1 && month <= 12;
  }
}
