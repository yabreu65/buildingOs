import { Injectable } from '@nestjs/common';
import type { CanonicalFinancePeriod, ResolvedFinancePeriod } from './finance-period.types';

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

@Injectable()
export class PeriodResolverService {
  resolve(period: CanonicalFinancePeriod, referenceDate: Date = new Date()): ResolvedFinancePeriod {
    switch (period.kind) {
      case 'current_month':
        return this.resolveSingleMonth(this.currentMonth(referenceDate));
      case 'previous_month':
        return this.resolveSingleMonth(this.previousMonth(referenceDate));
      case 'named_month':
        return this.resolveNamedMonth(period.year, period.month);
      case 'year_to_date':
        return this.resolveYearToDate(referenceDate);
      case 'relative_range':
        return this.resolveRelativeRange(period, referenceDate);
      case 'month_range':
        return this.resolveExplicitRange(period);
      case 'accumulated':
        return {
          kind: 'accumulated',
          periods: [],
          period: null,
          startPeriod: null,
          endPeriod: null,
          startDate: null,
          endDate: null,
          label: 'acumulada',
        };
      default:
        return {
          kind: 'unknown',
          periods: [],
          period: null,
          startPeriod: null,
          endPeriod: null,
          startDate: null,
          endDate: null,
          label: 'desconocido',
        };
    }
  }

  private resolveSingleMonth(periodKey: string): ResolvedFinancePeriod {
    const [yearText, monthText] = periodKey.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    return {
      kind: 'single_period',
      periods: [periodKey],
      period: periodKey,
      startPeriod: periodKey,
      endPeriod: periodKey,
      startDate,
      endDate,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
    };
  }

  private resolveNamedMonth(year: number | null, month: number | null): ResolvedFinancePeriod {
    if (!year || !month) {
      return {
        kind: 'unknown',
        periods: [],
        period: null,
        startPeriod: null,
        endPeriod: null,
        startDate: null,
        endDate: null,
        label: 'desconocido',
      };
    }

    return this.resolveSingleMonth(`${year}-${String(month).padStart(2, '0')}`);
  }

  private resolveYearToDate(referenceDate: Date): ResolvedFinancePeriod {
    const currentYear = referenceDate.getFullYear();
    const currentMonth = referenceDate.getMonth() + 1;
    const periods = this.buildPeriods(currentYear, 1, currentYear, currentMonth);
    return this.buildRangeResult(periods, 'año en curso', currentYear, 1, currentYear, currentMonth);
  }

  private resolveRelativeRange(
    period: CanonicalFinancePeriod,
    referenceDate: Date,
  ): ResolvedFinancePeriod {
    if (!period.amount || period.amount < 1 || !period.unit) {
      return {
        kind: 'unknown',
        periods: [],
        period: null,
        startPeriod: null,
        endPeriod: null,
        startDate: null,
        endDate: null,
        label: 'desconocido',
      };
    }

    const currentYear = referenceDate.getFullYear();
    const currentMonth = referenceDate.getMonth() + 1;
    const includeCurrent = period.mode === 'including_current';
    const endIndex = includeCurrent ? this.toMonthIndex(currentYear, currentMonth) : this.toMonthIndex(currentYear, currentMonth) - 1;
    const startIndex = endIndex - period.amount + 1;

    const periods = this.buildPeriodsFromIndexes(startIndex, endIndex);
    const startPeriod = periods[0] ?? null;
    const endPeriod = periods[periods.length - 1] ?? null;
    const startDate = startPeriod ? this.monthStartDate(startPeriod) : null;
    const endDate = endPeriod ? this.monthEndDate(endPeriod) : null;
    const label = startPeriod && endPeriod ? this.buildLabel(startPeriod, endPeriod) : 'desconocido';

    return {
      kind: 'period_range',
      periods,
      period: null,
      startPeriod,
      endPeriod,
      startDate,
      endDate,
      label,
    };
  }

  private resolveExplicitRange(period: CanonicalFinancePeriod): ResolvedFinancePeriod {
    if (!period.startYear || !period.startMonth || !period.endYear || !period.endMonth) {
      return {
        kind: 'unknown',
        periods: [],
        period: null,
        startPeriod: null,
        endPeriod: null,
        startDate: null,
        endDate: null,
        label: 'desconocido',
      };
    }

    const periods = this.buildPeriods(period.startYear, period.startMonth, period.endYear, period.endMonth);
    return this.buildRangeResult(periods, this.buildLabel(periods[0] ?? '', periods[periods.length - 1] ?? ''), period.startYear, period.startMonth, period.endYear, period.endMonth);
  }

  private buildRangeResult(
    periods: string[],
    label: string,
    startYear: number,
    startMonth: number,
    endYear: number,
    endMonth: number,
  ): ResolvedFinancePeriod {
    const startPeriod = periods[0] ?? null;
    const endPeriod = periods[periods.length - 1] ?? null;
    return {
      kind: 'period_range',
      periods,
      period: null,
      startPeriod,
      endPeriod,
      startDate: new Date(startYear, startMonth - 1, 1),
      endDate: new Date(endYear, endMonth, 0, 23, 59, 59, 999),
      label,
    };
  }

  private buildPeriods(startYear: number, startMonth: number, endYear: number, endMonth: number): string[] {
    const startIndex = this.toMonthIndex(startYear, startMonth);
    const endIndex = this.toMonthIndex(endYear, endMonth);
    return this.buildPeriodsFromIndexes(startIndex, endIndex);
  }

  private buildPeriodsFromIndexes(startIndex: number, endIndex: number): string[] {
    const periods: string[] = [];
    if (endIndex < startIndex) {
      return periods;
    }

    for (let index = startIndex; index <= endIndex; index += 1) {
      const { year, month } = this.fromMonthIndex(index);
      periods.push(`${year}-${String(month).padStart(2, '0')}`);
    }

    return periods;
  }

  private currentMonth(referenceDate: Date): string {
    return `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, '0')}`;
  }

  private previousMonth(referenceDate: Date): string {
    const index = this.toMonthIndex(referenceDate.getFullYear(), referenceDate.getMonth() + 1) - 1;
    const { year, month } = this.fromMonthIndex(index);
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  private toMonthIndex(year: number, month: number): number {
    return year * 12 + (month - 1);
  }

  private fromMonthIndex(index: number): { year: number; month: number } {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    return { year, month };
  }

  private monthStartDate(periodKey: string): Date {
    const [yearText, monthText] = periodKey.split('-');
    return new Date(Number(yearText), Number(monthText) - 1, 1);
  }

  private monthEndDate(periodKey: string): Date {
    const [yearText, monthText] = periodKey.split('-');
    return new Date(Number(yearText), Number(monthText), 0, 23, 59, 59, 999);
  }

  private buildLabel(startPeriod: string, endPeriod: string): string {
    if (startPeriod === endPeriod) {
      const [yearText, monthText] = startPeriod.split('-');
      return `${MONTH_NAMES[Number(monthText) - 1]} ${yearText}`;
    }

    const [startYearText, startMonthText] = startPeriod.split('-');
    const [endYearText, endMonthText] = endPeriod.split('-');
    return `${MONTH_NAMES[Number(startMonthText) - 1]} ${startYearText} a ${MONTH_NAMES[Number(endMonthText) - 1]} ${endYearText}`;
  }
}
