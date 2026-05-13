import { Injectable } from '@nestjs/common';
import { StructuredResponse, ResponseType, SuggestedAction, IntentFilters } from '../intent-engine/intent.types';
import { ChatResponse, SuggestedActionType } from '../ai.types';

/**
 * Supported formatter types
 */
type FormatterType = 'text' | 'table' | 'kpi' | 'chart' | 'clarification' | 'action_list';

/**
 * Intent to action type mapping
 */
const INTENT_TO_ACTION: Record<string, SuggestedActionType> = {
  list_residents: 'VIEW_REPORTS',
  get_residents: 'VIEW_REPORTS',
  unit_residents: 'VIEW_REPORTS',
  get_balance: 'VIEW_PAYMENTS',
  unit_debt: 'VIEW_PAYMENTS',
  unit_documents: 'VIEW_DOCUMENTS',
  list_documents: 'VIEW_DOCUMENTS',
  unit_tickets: 'VIEW_TICKETS',
  search_tickets: 'VIEW_TICKETS',
  unit_payments: 'VIEW_PAYMENTS',
  list_payments: 'VIEW_PAYMENTS',
  building_debt: 'VIEW_PAYMENTS',
  get_building_debt: 'VIEW_PAYMENTS',
  building_delinquents: 'VIEW_PAYMENTS',
  top_debtors: 'VIEW_PAYMENTS',
  building_documents: 'VIEW_DOCUMENTS',
  list_building_documents: 'VIEW_DOCUMENTS',
  building_tickets: 'VIEW_TICKETS',
  building_payments: 'VIEW_PAYMENTS',
  building_stats: 'VIEW_REPORTS',
  get_building_stats: 'VIEW_REPORTS',
};

/**
 * Intent to title mapping
 */
const INTENT_TO_TITLE: Record<string, string> = {
  list_residents: 'Residents',
  get_residents: 'Residents',
  unit_residents: 'Unit Residents',
  get_balance: 'Balance',
  unit_debt: 'Unit Debt',
  unit_documents: 'Unit Documents',
  list_documents: 'Documents',
  unit_tickets: 'Unit Tickets',
  search_tickets: 'Tickets',
  unit_payments: 'Unit Payments',
  list_payments: 'Payments',
  building_debt: 'Building Debt',
  get_building_debt: 'Building Debt',
  building_delinquents: 'Top Debtors',
  top_debtors: 'Top Debtors',
  building_documents: 'Building Documents',
  list_building_documents: 'Building Documents',
  building_tickets: 'Building Tickets',
  building_payments: 'Building Payments',
  building_stats: 'Building Statistics',
  get_building_stats: 'Building Statistics',
};

/**
 * ResponseFormatterService - Formats intent execution results for API responses
 *
 * Provides two formatting modes:
 * - V1: Backward compatible markdown string (ChatResponse)
 * - V2: Structured response with type, title, summary, data, and actions (StructuredResponse)
 *
 * Supported formatters: text, table, kpi, chart, clarification
 * Currency formatting uses es-VE locale for Venezuelan context.
 *
 * @example
 * ```typescript
 * const chatResponse = formatter.formatV1(data, 'list_payments');
 * const structured = formatter.formatV2(data, 'list_payments', 0.95);
 * ```
 */
@Injectable()
export class ResponseFormatterService {
  /**
   * Format data as V1 backward compatible ChatResponse
   *
   * @param data - Raw data from executor
   * @param intent - Intent name for context
   * @returns ChatResponse with markdown-formatted answer
   */
  formatV1(data: unknown, intent: string): ChatResponse {
    const formatter = this.determineFormatter(intent, data);
    const answer = this.formatWithFormatter(data, formatter);

    return {
      answer,
      suggestedActions: this.buildSuggestedActions(intent),
    };
  }

  /**
   * Format data as V2 StructuredResponse
   *
   * @param data - Raw data from executor
   * @param intent - Intent name for context
   * @param confidence - Confidence score from extraction
   * @returns StructuredResponse with type, title, summary, data, actions, meta
   */
  formatV2(data: unknown, intent: string, confidence: number): StructuredResponse {
    const formatter = this.determineFormatter(intent, data);
    const type = this.determineResponseType(intent, data);
    const title = INTENT_TO_TITLE[intent] ?? 'Response';
    const summary = this.formatSummary(data, formatter, intent);

    return {
      type,
      title,
      summary,
      data,
      actions: this.buildStructuredActions(intent),
      meta: {
        confidence,
        formattedWith: formatter,
      },
    };
  }

  /**
   * Build actions for StructuredResponse format
   */
  private buildStructuredActions(intent: string): import('../intent-engine/intent.types').SuggestedAction[] {
    const actionType = INTENT_TO_ACTION[intent];
    if (!actionType) {
      return [];
    }

    return [{ action: actionType, label: this.getActionLabel(actionType), payload: {} }];
  }

  /**
   * Determine the appropriate formatter based on intent and data shape
   */
  private determineFormatter(intent: string, data: unknown): FormatterType {
    // Single value KPIs
    if (this.isKpiData(data)) {
      return 'kpi';
    }

    // Clarification for ambiguous data
    if (this.isClarificationData(data)) {
      return 'clarification';
    }

    // List data -> table
    if (this.isListData(data)) {
      return 'table';
    }

    // Chart data
    if (this.isChartData(data)) {
      return 'chart';
    }

    // Default to text
    return 'text';
  }

  /**
   * Determine response type based on intent and data
   */
  private determineResponseType(intent: string, data: unknown): ResponseType {
    const formatter = this.determineFormatter(intent, data);

    switch (formatter) {
      case 'table':
        return 'table';
      case 'kpi':
        return 'kpi';
      case 'chart':
        return 'chart';
      case 'clarification':
        return 'clarification';
      default:
        return 'text';
    }
  }

  /**
   * Format data using the specified formatter
   */
  private formatWithFormatter(data: unknown, formatter: FormatterType): string {
    switch (formatter) {
      case 'table':
        return this.formatTable(data);
      case 'kpi':
        return this.formatKpi(data);
      case 'chart':
        return this.formatChart(data);
      case 'clarification':
        return this.formatClarification(data);
      default:
        return this.formatText(data);
    }
  }

  /**
   * Format data as markdown table
   */
  private formatTable(data: unknown): string {
    if (!Array.isArray(data) || data.length === 0) {
      return 'No data available';
    }

    const firstRow = data[0] as Record<string, unknown>;
    const headers = Object.keys(firstRow);

    const headerRow = `| ${headers.join(' | ')} |`;
    const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;

    const rows = data.map((row) => {
      const record = row as Record<string, unknown>;
      const values = headers.map((h) => this.formatCellValue(record[h]));
      return `| ${values.join(' | ')} |`;
    });

    return [headerRow, separatorRow, ...rows].join('\n');
  }

  /**
   * Format a single cell value (handles money, dates, etc.)
   */
  private formatCellValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'number') {
      // Check if it looks like a money amount (whole numbers >= 100)
      if (Number.isInteger(value) && value >= 100) {
        return this.formatMoney(value);
      }
      return String(value);
    }

    if (typeof value === 'string') {
      // Check if it looks like an ISO date
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        return this.formatDate(value);
      }
      return value;
    }

    return String(value);
  }

  /**
   * Format money amount with es-VE locale
   */
  private formatMoney(amountCents: number, currency = 'VES'): string {
    const amount = amountCents / 100;
    try {
      return new Intl.NumberFormat('es-VE', { style: 'currency', currency }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency}`;
    }
  }

  /**
   * Format date string to locale format
   */
  private formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('es-AR');
    } catch {
      return dateStr;
    }
  }

  /**
   * Format KPI data as text
   */
  private formatKpi(data: unknown): string {
    if (typeof data !== 'object' || data === null) {
      return String(data);
    }

    const record = data as Record<string, unknown>;
    const lines: string[] = [];

    for (const [key, value] of Object.entries(record)) {
      const label = this.formatLabel(key);
      if (typeof value === 'number' && this.isMoneyField(key)) {
        lines.push(`${label}: ${this.formatMoney(value)}`);
      } else if (typeof value === 'number') {
        lines.push(`${label}: ${value}`);
      } else {
        lines.push(`${label}: ${value}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format chart data as text representation
   */
  private formatChart(data: unknown): string {
    // Simple text-based chart representation
    if (!Array.isArray(data) || data.length === 0) {
      return 'No chart data available';
    }

    const lines: string[] = ['Chart Data:'];
    for (const item of data) {
      if (typeof item === 'object' && item !== null) {
        const record = item as Record<string, unknown>;
        const label = record.label ?? record.name ?? record.category ?? String(item);
        const value = record.value ?? record.amount ?? record.count ?? 0;
        lines.push(`- ${label}: ${value}`);
      } else {
        lines.push(`- ${item}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format clarification response
   */
  private formatClarification(data: unknown): string {
    if (typeof data !== 'object' || data === null) {
      return 'Please clarify your request';
    }

    const record = data as Record<string, unknown>;
    const alternatives = record.alternatives as Array<{ id: string; displayName: string }>;

    if (Array.isArray(alternatives) && alternatives.length > 0) {
      const lines = ['Please clarify which one you mean:'];
      for (const alt of alternatives) {
        lines.push(`- ${alt.displayName}`);
      }
      return lines.join('\n');
    }

    return 'Please clarify your request';
  }

  /**
   * Format text response
   */
  private formatText(data: unknown): string {
    if (typeof data === 'string') {
      return data;
    }

    if (typeof data === 'object' && data !== null) {
      return JSON.stringify(data, null, 2);
    }

    return String(data);
  }

  /**
   * Format summary text based on formatter type
   */
  private formatSummary(data: unknown, formatter: FormatterType, intent?: string): string {
    // Intent-specific summaries with real data
    if (intent && data && typeof data === 'object') {
      const record = data as Record<string, unknown>;

      switch (intent) {
        case 'unit_debt': {
          const totalDebt = record.totalDebt as number;
          const currency = (record.currency as string) || 'VES';
          const overduePeriodCount = record.overduePeriodCount as number | undefined;
          if (totalDebt !== undefined) {
            const debtSummary = `Deuda total: ${this.formatMoney(totalDebt, currency)}`;
            if (overduePeriodCount !== undefined) {
              const periodLabel = overduePeriodCount === 1 ? 'mes adeudado' : 'meses adeudados';
              return `${debtSummary} (${overduePeriodCount} ${periodLabel})`;
            }
            return debtSummary;
          }
          break;
        }

        case 'building_debt': {
          const totalDebt = record.totalDebt as number;
          const currency = (record.currency as string) || 'VES';
          if (totalDebt !== undefined) {
            return `Deuda total: ${this.formatMoney(totalDebt, currency)}`;
          }
          break;
        }

        case 'unit_residents': {
          const residents = record.residents as Array<Record<string, unknown>>;
          if (Array.isArray(residents)) {
            const names = residents.map((r) => r.name || 'Desconocido').join(', ');
            return `${residents.length} residente${residents.length === 1 ? '' : 's'}: ${names}`;
          }
          break;
        }

        case 'unit_payments':
        case 'building_payments': {
          const payments = record.payments as Array<Record<string, unknown>>;
          if (Array.isArray(payments)) {
            const currency = (record.currency as string) || 'ARS';
            const explicitTotalAmount = typeof record.totalAmount === 'number' ? record.totalAmount : undefined;
            const sumByMethod = record.sumByMethod as Record<string, number> | undefined;
            const inferredTotal =
              explicitTotalAmount ??
              (sumByMethod
                ? Object.values(sumByMethod).reduce((acc, value) => acc + Number(value || 0), 0)
                : payments.reduce((acc, payment) => acc + Number(payment.amount || 0), 0));

            const countText = `${payments.length} pago${payments.length === 1 ? '' : 's'} encontrado${payments.length === 1 ? '' : 's'}`;
            return `${countText}. Monto total: ${this.formatMoney(inferredTotal, currency)}`;
          }
          break;
        }

        case 'unit_tickets':
        case 'building_tickets': {
          const tickets = record.tickets as Array<Record<string, unknown>>;
          if (Array.isArray(tickets)) {
            return `${tickets.length} ticket${tickets.length === 1 ? '' : 's'} encontrado${tickets.length === 1 ? '' : 's'}`;
          }
          break;
        }

        case 'unit_documents':
        case 'building_documents': {
          const documents = record.documents as Array<Record<string, unknown>>;
          if (Array.isArray(documents)) {
            return `${documents.length} documento${documents.length === 1 ? '' : 's'} encontrado${documents.length === 1 ? '' : 's'}`;
          }
          break;
        }

        case 'building_delinquents': {
          const delinquents = record.delinquents as Array<Record<string, unknown>>;
          if (Array.isArray(delinquents)) {
            return `${delinquents.length} unidad${delinquents.length === 1 ? '' : 'es'} con deuda pendiente`;
          }
          break;
        }

        case 'building_stats': {
          const stats = record.stats as Record<string, unknown>;
          if (stats) {
            const totalUnits = stats.totalUnits as number;
            const occupied = stats.occupiedUnits as number;
            const vacant = stats.vacantUnits as number;
            const parts: string[] = [];
            if (totalUnits !== undefined) parts.push(`${totalUnits} unidades totales`);
            if (occupied !== undefined) parts.push(`${occupied} ocupadas`);
            if (vacant !== undefined) parts.push(`${vacant} vacantes`);
            return parts.join(' | ');
          }
          break;
        }

        case 'expenses_summary': {
          const totalExpenses = record.totalExpenses as number;
          if (totalExpenses !== undefined) {
            return `Gastos totales: ${this.formatMoney(totalExpenses)}`;
          }
          break;
        }

        case 'cashflow_compare': {
          const income = record.income as number;
          const expenses = record.expenses as number;
          if (income !== undefined && expenses !== undefined) {
            const diff = income - expenses;
            return `Ingresos: ${this.formatMoney(income)} | Gastos: ${this.formatMoney(expenses)} | Diferencia: ${this.formatMoney(Math.abs(diff))} ${diff >= 0 ? '(superávit)' : '(déficit)'}`;
          }
          break;
        }

        case 'vendors_list': {
          const vendors = record.vendors as Array<Record<string, unknown>>;
          if (Array.isArray(vendors)) {
            return `${vendors.length} proveedor${vendors.length === 1 ? '' : 'es'} activo${vendors.length === 1 ? '' : 's'}`;
          }
          break;
        }

        case 'communications_send_reminder': {
          const sent = record.sent as number;
          if (sent !== undefined) {
            return `${sent} recordatorio${sent === 1 ? '' : 's'} enviado${sent === 1 ? '' : 's'}`;
          }
          break;
        }
      }
    }

    // Fallback to generic formatter-based summaries
    switch (formatter) {
      case 'table':
        if (Array.isArray(data)) {
          return `${data.length} resultado${data.length === 1 ? '' : 's'}`;
        }
        return 'Resultados de la consulta';
      case 'kpi':
        return 'Métrica clave';
      case 'chart':
        return 'Datos del gráfico';
      case 'clarification':
        if (data && typeof data === 'object') {
          const record = data as Record<string, unknown>;
          const clarificationMessage = record.clarificationMessage;
          if (typeof clarificationMessage === 'string' && clarificationMessage.trim().length > 0) {
            return clarificationMessage;
          }
        }
        return 'Se requiere clarificación';
      default:
        return 'Respuesta';
    }
  }

  /**
   * Build suggested actions based on intent (V1 format - ChatResponse)
   */
  private buildSuggestedActions(intent: string): import('../ai.types').SuggestedAction[] {
    const actionType = INTENT_TO_ACTION[intent];
    if (!actionType) {
      return [];
    }

    return [{ type: actionType, payload: {} }];
  }

  /**
   * Get human-readable label for action type
   */
  private getActionLabel(type: SuggestedActionType): string {
    const labels: Record<SuggestedActionType, string> = {
      VIEW_TICKETS: 'View Tickets',
      VIEW_PAYMENTS: 'View Payments',
      VIEW_REPORTS: 'View Reports',
      VIEW_DOCUMENTS: 'View Documents',
      SEARCH_DOCS: 'Search Documents',
      DRAFT_COMMUNICATION: 'Draft Communication',
      CREATE_TICKET: 'Create Ticket',
    };
    return labels[type] ?? type;
  }

  /**
   * Format label from camelCase/snake_case key
   */
  private formatLabel(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  }

  /**
   * Check if data looks like a KPI (single object with numeric values)
   */
  private isKpiData(data: unknown): boolean {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return false;
    }

    const record = data as Record<string, unknown>;
    const values = Object.values(record);

    // Single level object with mostly numeric values
    if (values.length <= 5) {
      const numericCount = values.filter((v) => typeof v === 'number').length;
      return numericCount >= values.length / 2;
    }

    return false;
  }

  /**
   * Check if data is clarification data
   */
  private isClarificationData(data: unknown): boolean {
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    const record = data as Record<string, unknown>;
    return record.isAmbiguous === true || Array.isArray(record.alternatives);
  }

  /**
   * Check if data is list data
   */
  private isListData(data: unknown): boolean {
    return Array.isArray(data) && data.length > 0;
  }

  /**
   * Check if data is chart data
   */
  private isChartData(data: unknown): boolean {
    if (!Array.isArray(data)) {
      return false;
    }

    // Check if items have chart-like structure
    return data.some((item) => {
      if (typeof item !== 'object' || item === null) {
        return false;
      }
      const record = item as Record<string, unknown>;
      return ('value' in record || 'amount' in record || 'count' in record) && ('label' in record || 'name' in record || 'category' in record);
    });
  }

  /**
   * Check if field name suggests money value
   */
  private isMoneyField(fieldName: string): boolean {
    const moneyFields = ['amount', 'total', 'debt', 'balance', 'price', 'cost', 'revenue', 'income'];
    return moneyFields.some((f) => fieldName.toLowerCase().includes(f));
  }
}
