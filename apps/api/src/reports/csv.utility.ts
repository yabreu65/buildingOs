import { PayloadTooLargeException } from '@nestjs/common';

export interface CsvOptions {
  headers: string[];
  rows: any[];
  maxRows?: number;
  filename: string;
}

export interface CsvExportResult {
  content: string;
  filename: string;
  rows: number;
}

/**
 * CSV Utility: Format data to CSV and validate export sizes
 */
export class CsvUtility {
  // Maximum rows allowed per export (MVP limit)
  static readonly MAX_ROWS = 10_000;

  /**
   * Convert array of objects to CSV format
   *
   * @param headers Column names for header row
   * @param rows Data rows (objects)
   * @param filename For Content-Disposition header
   * @returns CSV content string
   *
   * Example:
   * ```
   * CsvUtility.formatCsv(
   *   ['id', 'title', 'status'],
   *   [{id: '1', title: 'Bug', status: 'OPEN'}],
   *   'tickets.csv'
   * )
   * // Returns: "id,title,status\n1,Bug,OPEN\n"
   * ```
   */
  static formatCsv(
    headers: string[],
    rows: any[],
    filename: string,
  ): CsvExportResult {
    // Validate export size
    this.validateExportSize(rows.length);

    // Build CSV header row
    const headerRow = this.escapeCsvRow(headers);

    // Build CSV data rows
    const dataRows = rows.map((row) => {
      const values = headers.map((header) => row[header] ?? '');
      return this.escapeCsvRow(values);
    });

    // Combine header + data
    const content = [headerRow, ...dataRows].join('\n');

    return {
      content,
      filename,
      rows: rows.length,
    };
  }

  /**
   * Validate that export doesn't exceed MAX_ROWS limit
   * Throws PayloadTooLargeException if exceeded
   */
  static validateExportSize(rowCount: number): void {
    if (rowCount > this.MAX_ROWS) {
      throw new PayloadTooLargeException({
        code: 'EXPORT_TOO_LARGE',
        message: `Export exceeds maximum limit of ${this.MAX_ROWS} rows (got ${rowCount})`,
        metadata: {
          limit: this.MAX_ROWS,
          requested: rowCount,
          suggestion: 'Try filtering by building or date range to reduce results',
        },
      });
    }
  }

  /**
   * Escape CSV row: quote fields with commas/quotes, escape inner quotes
   *
   * Rules:
   * - If field contains comma, quote, or newline → wrap in quotes
   * - If field contains quote → escape as double quote
   * - Otherwise → use as-is
   *
   * Example:
   * ```
   * escapeCsvRow(['a', 'b,c', 'd"e'])
   * // Returns: 'a,"b,c","d""e"'
   * ```
   */
  private static escapeCsvRow(values: any[]): string {
    return values
      .map((value) => {
        // Convert to string
        let str = String(value ?? '').trim();

        // If contains comma, quote, or newline → escape
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          // Escape inner quotes as double quote
          str = str.replace(/"/g, '""');
          // Wrap in quotes
          return `"${str}"`;
        }

        return str;
      })
      .join(',');
  }

  /**
   * Format date to ISO 8601 (YYYY-MM-DD)
   * Used in CSV rows for consistency
   */
  static formatDate(date?: Date): string {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  }

  /**
   * Format decimal amount (cents to dollars for readability)
   * Keeps 2 decimal places
   */
  static formatAmount(cents: number): string {
    if (typeof cents !== 'number') return '';
    return (cents / 100).toFixed(2);
  }

  /**
   * Generate filename with timestamp
   * Example: "tickets_2026-02-18.csv"
   */
  static generateFilename(reportType: string): string {
    const today = new Date().toISOString().split('T')[0];
    return `${reportType}_${today}.csv`;
  }
}
