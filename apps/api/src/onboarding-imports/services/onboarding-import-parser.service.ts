import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as XLSX from 'xlsx';
import { ImportIssueSeverity } from '@prisma/client';
import {
  ONBOARDING_IMPORT_MAX_CELL_TEXT_LENGTH,
  ONBOARDING_IMPORT_MAX_COLUMNS_PER_SHEET,
  ONBOARDING_IMPORT_MAX_ROWS_PER_SHEET,
  ONBOARDING_IMPORT_MAX_SHEETS,
  ONBOARDING_IMPORT_MAX_ZIP_ENTRIES,
  ONBOARDING_IMPORT_MAX_ZIP_RATIO,
  ONBOARDING_IMPORT_MAX_ZIP_UNCOMPRESSED_BYTES,
  ONBOARDING_IMPORT_SHEETS,
} from '../onboarding-imports.constants';
import { OnboardingImportNormalizerService } from './onboarding-import-normalizer.service';
import type {
  ImportIssueRecord,
  ImportSheetName,
  ParsedBuildingRowNormalized,
  ParsedBuildingRowRaw,
  ParsedOpeningBalanceRowNormalized,
  ParsedOpeningBalanceRowRaw,
  ParsedPersonRowNormalized,
  ParsedPersonRowRaw,
  ParsedRow,
  ParsedUnitRelationRowNormalized,
  ParsedUnitRelationRowRaw,
  ParsedUnitRowNormalized,
  ParsedUnitRowRaw,
  ParsedWorkbookData,
  WorkbookParseResult,
} from '../types/onboarding-import.types';

interface ZipInspectionResult {
  readonly entryCount: number;
  readonly uncompressedSize: number;
  readonly compressedSize: number;
  readonly sheetEntries: number;
}

interface SheetSchema {
  readonly name: ImportSheetName;
  readonly headers: readonly string[];
  readonly requiredHeaders: readonly string[];
}

@Injectable()
export class OnboardingImportParserService {
  private readonly sheetSchemas: SheetSchema[] = [
    {
      name: ONBOARDING_IMPORT_SHEETS.buildings,
      headers: ['codigo', 'nombre', 'direccion'],
      requiredHeaders: ['codigo', 'nombre', 'direccion'],
    },
    {
      name: ONBOARDING_IMPORT_SHEETS.units,
      headers: ['edificio_codigo', 'codigo', 'etiqueta', 'tipo', 'm2', 'facturacion', 'categoria_nombre', 'coeficiente'],
      requiredHeaders: ['edificio_codigo', 'codigo', 'tipo', 'facturacion'],
    },
    {
      name: ONBOARDING_IMPORT_SHEETS.people,
      headers: ['persona_codigo', 'nombre', 'email', 'telefono', 'documento'],
      requiredHeaders: ['persona_codigo', 'nombre'],
    },
    {
      name: ONBOARDING_IMPORT_SHEETS.relations,
      headers: ['persona_codigo', 'edificio_codigo', 'unidad_codigo', 'rol', 'principal', 'fecha_inicio'],
      requiredHeaders: ['persona_codigo', 'edificio_codigo', 'unidad_codigo', 'rol', 'principal', 'fecha_inicio'],
    },
    {
      name: ONBOARDING_IMPORT_SHEETS.openingBalances,
      headers: ['edificio_codigo', 'unidad_codigo', 'periodo', 'concepto', 'monto', 'moneda', 'vencimiento', 'tipo'],
      requiredHeaders: ['edificio_codigo', 'unidad_codigo', 'periodo', 'concepto', 'monto', 'moneda', 'vencimiento', 'tipo'],
    },
  ];

  constructor(private readonly normalizer: OnboardingImportNormalizerService) {}

  parseWorkbook(buffer: Buffer): WorkbookParseResult {
    this.inspectZip(buffer);

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        cellFormula: true,
        raw: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UnprocessableEntityException({
        code: 'WORKBOOK_PARSE_FAILED',
        message: 'El archivo no es un Excel válido o está protegido con contraseña',
        details: message.slice(0, 160),
      });
    }

    if (workbook.SheetNames.length === 0) {
      throw new UnprocessableEntityException({
        code: 'WORKBOOK_EMPTY',
        message: 'El archivo no contiene hojas',
      });
    }

    if (workbook.SheetNames.length > ONBOARDING_IMPORT_MAX_SHEETS) {
      throw new PayloadTooLargeException({
        code: 'WORKBOOK_TOO_MANY_SHEETS',
        message: `El archivo supera el máximo de ${ONBOARDING_IMPORT_MAX_SHEETS} hojas`,
      });
    }

    const issues: ImportIssueRecord[] = [];
    const normalizedSheetNames = new Map<string, string[]>();

    for (const sheetName of workbook.SheetNames) {
      const normalizedSheetName = this.normalizer.normalizeSheetName(sheetName);
      const matches = normalizedSheetNames.get(normalizedSheetName) ?? [];
      matches.push(sheetName);
      normalizedSheetNames.set(normalizedSheetName, matches);
    }

    for (const [normalizedSheetName, matches] of normalizedSheetNames.entries()) {
      if (matches.length > 1) {
        issues.push(this.makeIssue(
          ONBOARDING_IMPORT_SHEETS.instructions,
          null,
          null,
          'DUPLICATE_SHEET_NAME',
          'BLOCKER',
          `The workbook contains duplicate sheets after normalization: ${matches.join(', ')}`,
          matches.join(', '),
          normalizedSheetName,
        ));
      }
    }

    const data: ParsedWorkbookData = {
      buildings: this.parseBuildingsSheet(workbook, issues),
      units: this.parseUnitsSheet(workbook, issues),
      people: this.parsePeopleSheet(workbook, issues),
      relations: this.parseRelationsSheet(workbook, issues),
      openingBalances: this.parseOpeningBalancesSheet(workbook, issues),
    };

    return { data, issues };
  }

  private parseBuildingsSheet(
    workbook: XLSX.WorkBook,
    issues: ImportIssueRecord[],
  ): Array<ParsedRow<ParsedBuildingRowRaw, ParsedBuildingRowNormalized>> {
    return this.parseSheet<ParsedBuildingRowRaw, ParsedBuildingRowNormalized>(
      workbook,
      this.sheetSchemas[0]!,
      issues,
      (sheet, row, rowNumber, rowIssues) => this.parseBuildingRow(sheet, row, rowNumber, rowIssues),
    );
  }

  private parseUnitsSheet(
    workbook: XLSX.WorkBook,
    issues: ImportIssueRecord[],
  ): Array<ParsedRow<ParsedUnitRowRaw, ParsedUnitRowNormalized>> {
    return this.parseSheet<ParsedUnitRowRaw, ParsedUnitRowNormalized>(
      workbook,
      this.sheetSchemas[1]!,
      issues,
      (sheet, row, rowNumber, rowIssues) => this.parseUnitRow(sheet, row, rowNumber, rowIssues),
    );
  }

  private parsePeopleSheet(
    workbook: XLSX.WorkBook,
    issues: ImportIssueRecord[],
  ): Array<ParsedRow<ParsedPersonRowRaw, ParsedPersonRowNormalized>> {
    return this.parseSheet<ParsedPersonRowRaw, ParsedPersonRowNormalized>(
      workbook,
      this.sheetSchemas[2]!,
      issues,
      (sheet, row, rowNumber, rowIssues) => this.parsePersonRow(sheet, row, rowNumber, rowIssues),
    );
  }

  private parseRelationsSheet(
    workbook: XLSX.WorkBook,
    issues: ImportIssueRecord[],
  ): Array<ParsedRow<ParsedUnitRelationRowRaw, ParsedUnitRelationRowNormalized>> {
    return this.parseSheet<ParsedUnitRelationRowRaw, ParsedUnitRelationRowNormalized>(
      workbook,
      this.sheetSchemas[3]!,
      issues,
      (sheet, row, rowNumber, rowIssues) => this.parseRelationRow(sheet, row, rowNumber, rowIssues),
    );
  }

  private parseOpeningBalancesSheet(
    workbook: XLSX.WorkBook,
    issues: ImportIssueRecord[],
  ): Array<ParsedRow<ParsedOpeningBalanceRowRaw, ParsedOpeningBalanceRowNormalized>> {
    return this.parseSheet<ParsedOpeningBalanceRowRaw, ParsedOpeningBalanceRowNormalized>(
      workbook,
      this.sheetSchemas[4]!,
      issues,
      (sheet, row, rowNumber, rowIssues) => this.parseOpeningBalanceRow(sheet, row, rowNumber, rowIssues),
    );
  }

  private parseSheet<TRaw extends object, TNormalized extends object>(
    workbook: XLSX.WorkBook,
    schema: SheetSchema,
    issues: ImportIssueRecord[],
    rowParser: (
      sheet: ImportSheetName,
      row: Record<string, unknown>,
      rowNumber: number,
      rowIssues: ImportIssueRecord[],
    ) => TNormalized | null,
  ): Array<ParsedRow<TRaw, TNormalized>> {
    const worksheet = this.getWorksheet(workbook, schema.name, issues);
    if (!worksheet) {
      return [];
    }

    const ref = worksheet['!ref'];
    if (!ref) {
      issues.push(this.makeIssue(schema.name, null, null, 'EMPTY_SHEET', 'BLOCKER', 'The sheet is empty', null, null));
      return [];
    }

    const range = XLSX.utils.decode_range(ref);
    const totalRows = range.e.r - range.s.r + 1;
    const totalColumns = range.e.c - range.s.c + 1;

    if (totalRows - 1 > ONBOARDING_IMPORT_MAX_ROWS_PER_SHEET) {
      throw new PayloadTooLargeException({
        code: 'WORKBOOK_TOO_MANY_ROWS',
        message: `Sheet ${schema.name} exceeds the maximum of ${ONBOARDING_IMPORT_MAX_ROWS_PER_SHEET} data rows`,
      });
    }

    if (totalColumns > ONBOARDING_IMPORT_MAX_COLUMNS_PER_SHEET) {
      throw new PayloadTooLargeException({
        code: 'WORKBOOK_TOO_MANY_COLUMNS',
        message: `Sheet ${schema.name} exceeds the maximum of ${ONBOARDING_IMPORT_MAX_COLUMNS_PER_SHEET} columns`,
      });
    }

    const headerMap = this.readHeaders(worksheet, schema, issues, range);
    if (headerMap.size === 0) {
      return [];
    }

    const rows: Array<ParsedRow<TRaw, TNormalized>> = [];
    for (let rowNumber = range.s.r + 2; rowNumber <= range.e.r + 1; rowNumber += 1) {
      const rawRow = this.readRow(worksheet, headerMap, schema.headers, schema.name, rowNumber, issues);
      if (this.isBlankRow(rawRow)) {
        continue;
      }

      const rowIssues: ImportIssueRecord[] = [];
      const normalized = rowParser(schema.name, rawRow, rowNumber, rowIssues);
      issues.push(...rowIssues);

      rows.push({
        sheet: schema.name,
        rowNumber,
        raw: rawRow as TRaw,
        normalized,
      });
    }

    return rows;
  }

  private readHeaders(
    worksheet: XLSX.WorkSheet,
    schema: SheetSchema,
    issues: ImportIssueRecord[],
    range: XLSX.Range,
  ): Map<string, number> {
    const headerMap = new Map<string, number>();
    const seenHeaders = new Map<string, number>();

    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: range.s.r, c: column });
      const cell = worksheet[address] as XLSX.CellObject | undefined;
      const headerValue = this.normalizer.normalizeHeader(String(cell?.v ?? ''));

      if (!headerValue) {
        issues.push(this.makeIssue(schema.name, 1, this.columnLetter(column), 'MISSING_HEADER', 'BLOCKER', 'Header cell is empty', null, null));
        continue;
      }

      if (seenHeaders.has(headerValue)) {
        issues.push(this.makeIssue(schema.name, 1, this.columnLetter(column), 'DUPLICATE_HEADER', 'BLOCKER', `Duplicate header: ${headerValue}`, this.sanitizeForIssue(cell?.v), headerValue));
        continue;
      }

      seenHeaders.set(headerValue, column);
      headerMap.set(headerValue, column);

      if (!schema.headers.includes(headerValue)) {
        issues.push(this.makeIssue(schema.name, 1, this.columnLetter(column), 'UNKNOWN_HEADER', 'WARNING', `Unknown header: ${headerValue}`, this.sanitizeForIssue(cell?.v), headerValue));
      }
    }

    for (const requiredHeader of schema.requiredHeaders) {
      if (!headerMap.has(requiredHeader)) {
        issues.push(this.makeIssue(schema.name, 1, null, 'MISSING_HEADER', 'BLOCKER', `Missing required header: ${requiredHeader}`, null, null));
      }
    }

    const requiredPresence = schema.requiredHeaders.every((header) => headerMap.has(header));
    return requiredPresence ? headerMap : new Map<string, number>();
  }

  private readRow(
    worksheet: XLSX.WorkSheet,
    headerMap: Map<string, number>,
    headers: readonly string[],
    sheet: ImportSheetName,
    rowNumber: number,
    issues: ImportIssueRecord[],
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    for (const header of headers) {
      const column = headerMap.get(header);
      if (column === undefined) {
        row[header] = null;
        continue;
      }

      const address = XLSX.utils.encode_cell({ r: rowNumber - 1, c: column });
      const cell = worksheet[address] as XLSX.CellObject | undefined;
      if (cell?.f) {
        issues.push(this.makeIssue(
          sheet,
          rowNumber,
          this.columnLetter(column),
          'FORMULA_NOT_ALLOWED',
          'BLOCKER',
          'Formulas are not allowed in onboarding imports',
          this.sanitizeForIssue(`=${cell.f}`),
          null,
        ));
      }

      row[header] = this.readCellValue(cell);
    }

    return row;
  }

  private parseBuildingRow(
    sheet: ImportSheetName,
    row: Record<string, unknown>,
    rowNumber: number,
    issues: ImportIssueRecord[],
  ): ParsedBuildingRowNormalized | null {
    const codigo = this.safeNormalizeCode(sheet, row.codigo, 'codigo', rowNumber, 'codigo', issues);
    const nombre = this.safeNormalizeText(sheet, row.nombre, 'nombre', rowNumber, 'nombre', issues);
    const direccion = this.safeNormalizeText(sheet, row.direccion, 'direccion', rowNumber, 'direccion', issues);

    if (!codigo || !nombre || !direccion) {
      return null;
    }

    return { codigo, nombre, direccion };
  }

  private safeNormalizeCode(
    sheet: ImportSheetName,
    value: unknown,
    fieldName: string,
    rowNumber: number,
    column: string,
    issues: ImportIssueRecord[],
  ): string | null {
    try {
      return this.normalizer.normalizeCode(value, fieldName);
    } catch (error) {
      issues.push(this.makeIssue(sheet, rowNumber, column, 'INVALID_VALUE', 'BLOCKER', this.errorMessage(error, `${fieldName} is invalid`), this.sanitizeForIssue(value), null));
      return null;
    }
  }

  private parseUnitRow(
    sheet: ImportSheetName,
    row: Record<string, unknown>,
    rowNumber: number,
    issues: ImportIssueRecord[],
  ): ParsedUnitRowNormalized | null {
    const edificioCodigo = this.safeNormalizeCode(sheet, row.edificio_codigo, 'edificio_codigo', rowNumber, 'edificio_codigo', issues);
    const codigo = this.safeNormalizeCode(sheet, row.codigo, 'codigo', rowNumber, 'codigo', issues);
    const etiqueta = this.safeNormalizeOptionalText(row.etiqueta);
    const tipo = this.safeNormalizeUnitType(sheet, row.tipo, 'tipo', rowNumber, 'tipo', issues);
    const m2 = this.safeNormalizeOptionalDecimal(sheet, row.m2, 'm2', rowNumber, 'm2', issues);
    const facturacion = this.safeNormalizeBoolean(sheet, row.facturacion, 'facturacion', rowNumber, 'facturacion', issues);
    const categoriaNombre = this.safeNormalizeOptionalText(row.categoria_nombre);
    const coeficiente = this.safeNormalizeOptionalDecimal(sheet, row.coeficiente, 'coeficiente', rowNumber, 'coeficiente', issues);

    if (!edificioCodigo || !codigo || !tipo || facturacion === null) {
      return null;
    }

    if (coeficiente !== null && coeficiente <= 0) {
      issues.push(this.makeIssue(sheet, rowNumber, 'coeficiente', 'INVALID_VALUE', 'BLOCKER', 'Coeficiente must be greater than zero', this.sanitizeForIssue(row.coeficiente), String(coeficiente)));
      return null;
    }

    if (m2 !== null && m2 < 0) {
      issues.push(this.makeIssue(sheet, rowNumber, 'm2', 'INVALID_VALUE', 'BLOCKER', 'Square meters must be positive', this.sanitizeForIssue(row.m2), String(m2)));
      return null;
    }

    return {
      edificioCodigo,
      codigo,
      etiqueta,
      tipo,
      m2,
      facturacion,
      categoriaNombre,
      coeficiente,
    };
  }

  private parsePersonRow(
    sheet: ImportSheetName,
    row: Record<string, unknown>,
    rowNumber: number,
    issues: ImportIssueRecord[],
  ): ParsedPersonRowNormalized | null {
    const personaCodigo = this.safeNormalizeCode(sheet, row.persona_codigo, 'persona_codigo', rowNumber, 'persona_codigo', issues);
    const nombre = this.safeNormalizeText(sheet, row.nombre, 'nombre', rowNumber, 'nombre', issues);
    const email = this.safeNormalizeEmail(row.email);
    const telefono = this.safeNormalizeOptionalText(row.telefono);
    const documento = this.safeNormalizeOptionalText(row.documento);

    if (!personaCodigo || !nombre) {
      return null;
    }

    return { personaCodigo, nombre, email, telefono, documento };
  }

  private parseRelationRow(
    sheet: ImportSheetName,
    row: Record<string, unknown>,
    rowNumber: number,
    issues: ImportIssueRecord[],
  ): ParsedUnitRelationRowNormalized | null {
    const personaCodigo = this.safeNormalizeCode(sheet, row.persona_codigo, 'persona_codigo', rowNumber, 'persona_codigo', issues);
    const edificioCodigo = this.safeNormalizeCode(sheet, row.edificio_codigo, 'edificio_codigo', rowNumber, 'edificio_codigo', issues);
    const unidadCodigo = this.safeNormalizeCode(sheet, row.unidad_codigo, 'unidad_codigo', rowNumber, 'unidad_codigo', issues);
    const rolRaw = this.safeNormalizeCode(sheet, row.rol, 'rol', rowNumber, 'rol', issues);
    const principal = this.safeNormalizeBoolean(sheet, row.principal, 'principal', rowNumber, 'principal', issues);
    const startDate = this.safeNormalizeDate(sheet, row.fecha_inicio, 'fecha_inicio', rowNumber, 'fecha_inicio', issues);

    if (!personaCodigo || !edificioCodigo || !unidadCodigo || !rolRaw || principal === null || !startDate) {
      return null;
    }

    if (rolRaw !== 'OWNER' && rolRaw !== 'RESIDENT') {
      issues.push(this.makeIssue(sheet, rowNumber, 'rol', 'INVALID_VALUE', 'BLOCKER', 'Rol must be OWNER or RESIDENT', this.sanitizeForIssue(row.rol), rolRaw));
      return null;
    }

    return { personaCodigo, edificioCodigo, unidadCodigo, rol: rolRaw, principal, startDate };
  }

  private parseOpeningBalanceRow(
    sheet: ImportSheetName,
    row: Record<string, unknown>,
    rowNumber: number,
    issues: ImportIssueRecord[],
  ): ParsedOpeningBalanceRowNormalized | null {
    const edificioCodigo = this.safeNormalizeCode(sheet, row.edificio_codigo, 'edificio_codigo', rowNumber, 'edificio_codigo', issues);
    const unidadCodigo = this.safeNormalizeCode(sheet, row.unidad_codigo, 'unidad_codigo', rowNumber, 'unidad_codigo', issues);
    const period = this.safeNormalizePeriod(sheet, row.periodo, 'periodo', rowNumber, 'periodo', issues);
    const concept = this.safeNormalizeText(sheet, row.concepto, 'concepto', rowNumber, 'concepto', issues);
    const amountMinor = this.safeNormalizeDecimalToMinor(sheet, row.monto, 'monto', rowNumber, 'monto', issues);
    const currency = this.safeNormalizeCurrency(sheet, row.moneda, 'moneda', rowNumber, 'moneda', issues);
    const dueDate = this.safeNormalizeDate(sheet, row.vencimiento, 'vencimiento', rowNumber, 'vencimiento', issues);
    const kindRaw = this.safeNormalizeCode(sheet, row.tipo, 'tipo', rowNumber, 'tipo', issues);

    if (!edificioCodigo || !unidadCodigo || !period || !concept || amountMinor === null || !currency || !dueDate || !kindRaw) {
      return null;
    }

    if (amountMinor <= 0) {
      issues.push(this.makeIssue(sheet, rowNumber, 'monto', 'INVALID_VALUE', 'BLOCKER', 'Amount must be greater than zero', this.sanitizeForIssue(row.monto), String(amountMinor)));
      return null;
    }

    if (kindRaw !== 'DEBITO' && kindRaw !== 'CREDITO') {
      issues.push(this.makeIssue(sheet, rowNumber, 'tipo', 'INVALID_VALUE', 'BLOCKER', 'Tipo must be DEBITO or CREDITO', this.sanitizeForIssue(row.tipo), kindRaw));
      return null;
    }

    return { edificioCodigo, unidadCodigo, period, concept, amountMinor, currency, dueDate, kind: kindRaw };
  }

  private safeNormalizeText(
    sheet: ImportSheetName,
    value: unknown,
    fieldName: string,
    rowNumber: number,
    column: string,
    issues: ImportIssueRecord[],
  ): string | null {
    try {
      return this.normalizer.normalizeRequiredText(value, fieldName);
    } catch (error) {
      issues.push(this.makeIssue(sheet, rowNumber, column, 'INVALID_VALUE', 'BLOCKER', this.errorMessage(error, `${fieldName} is invalid`), this.sanitizeForIssue(value), null));
      return null;
    }
  }

  private safeNormalizeOptionalText(value: unknown): string | null {
    return this.normalizer.normalizeOptionalText(value);
  }

  private safeNormalizeEmail(value: unknown): string | null {
    return this.normalizer.normalizeEmail(value);
  }

  private safeNormalizeOptionalDecimal(
    sheet: ImportSheetName,
    value: unknown,
    fieldName: string,
    rowNumber: number,
    column: string,
    issues: ImportIssueRecord[],
  ): number | null {
    try {
      return this.normalizer.parseOptionalDecimalToMinor(value, fieldName);
    } catch (error) {
      issues.push(this.makeIssue(sheet, rowNumber, column, 'INVALID_VALUE', 'BLOCKER', this.errorMessage(error, `${fieldName} is invalid`), this.sanitizeForIssue(value), null));
      return null;
    }
  }

  private safeNormalizeDecimalToMinor(
    sheet: ImportSheetName,
    value: unknown,
    fieldName: string,
    rowNumber: number,
    column: string,
    issues: ImportIssueRecord[],
  ): number | null {
    try {
      return this.normalizer.parseDecimalToMinor(value, fieldName);
    } catch (error) {
      issues.push(this.makeIssue(sheet, rowNumber, column, 'INVALID_VALUE', 'BLOCKER', this.errorMessage(error, `${fieldName} is invalid`), this.sanitizeForIssue(value), null));
      return null;
    }
  }

  private safeNormalizeBoolean(
    sheet: ImportSheetName,
    value: unknown,
    fieldName: string,
    rowNumber: number,
    column: string,
    issues: ImportIssueRecord[],
  ): boolean | null {
    try {
      return this.normalizer.parseBoolean(value, fieldName);
    } catch (error) {
      issues.push(this.makeIssue(sheet, rowNumber, column, 'INVALID_VALUE', 'BLOCKER', this.errorMessage(error, `${fieldName} is invalid`), this.sanitizeForIssue(value), null));
      return null;
    }
  }

  private safeNormalizeCurrency(
    sheet: ImportSheetName,
    value: unknown,
    fieldName: string,
    rowNumber: number,
    column: string,
    issues: ImportIssueRecord[],
  ): string | null {
    try {
      return this.normalizer.parseCurrency(value, fieldName);
    } catch (error) {
      issues.push(this.makeIssue(sheet, rowNumber, column, 'INVALID_VALUE', 'BLOCKER', this.errorMessage(error, `${fieldName} is invalid`), this.sanitizeForIssue(value), null));
      return null;
    }
  }

  private safeNormalizeUnitType(
    sheet: ImportSheetName,
    value: unknown,
    fieldName: string,
    rowNumber: number,
    column: string,
    issues: ImportIssueRecord[],
  ): string | null {
    try {
      return this.normalizer.parseUnitType(value, fieldName);
    } catch (error) {
      issues.push(this.makeIssue(sheet, rowNumber, column, 'INVALID_VALUE', 'BLOCKER', this.errorMessage(error, `${fieldName} is invalid`), this.sanitizeForIssue(value), null));
      return null;
    }
  }

  private safeNormalizePeriod(
    sheet: ImportSheetName,
    value: unknown,
    fieldName: string,
    rowNumber: number,
    column: string,
    issues: ImportIssueRecord[],
  ): string | null {
    try {
      return this.normalizer.parsePeriod(value, fieldName);
    } catch (error) {
      issues.push(this.makeIssue(sheet, rowNumber, column, 'INVALID_VALUE', 'BLOCKER', this.errorMessage(error, `${fieldName} is invalid`), this.sanitizeForIssue(value), null));
      return null;
    }
  }

  private safeNormalizeDate(
    sheet: ImportSheetName,
    value: unknown,
    fieldName: string,
    rowNumber: number,
    column: string,
    issues: ImportIssueRecord[],
  ): string | null {
    try {
      return this.normalizer.parseDate(value, fieldName);
    } catch (error) {
      issues.push(this.makeIssue(sheet, rowNumber, column, 'INVALID_VALUE', 'BLOCKER', this.errorMessage(error, `${fieldName} is invalid`), this.sanitizeForIssue(value), null));
      return null;
    }
  }

  private readCellValue(cell: XLSX.CellObject | undefined): unknown {
    if (!cell) {
      return null;
    }

    if (cell.f) {
      return this.stringifyFormulaValue(cell.v);
    }

    return cell.v ?? null;
  }

  private stringifyFormulaValue(value: unknown): string {
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : '';
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    return String(value ?? '');
  }

  private isBlankRow(row: Record<string, unknown>): boolean {
    return Object.values(row).every((value) => value === null || value === undefined || value === '');
  }

  private getWorksheet(
    workbook: XLSX.WorkBook,
    sheetName: ImportSheetName,
    issues: ImportIssueRecord[],
  ): XLSX.WorkSheet | null {
    const normalized = this.normalizer.normalizeSheetName(sheetName);
    const matches = workbook.SheetNames.filter((candidate) => this.normalizer.normalizeSheetName(candidate) === normalized);

    if (matches.length === 0) {
      issues.push(this.makeIssue(sheetName, null, null, 'MISSING_SHEET', 'BLOCKER', `Missing required sheet: ${sheetName}`, null, null));
      return null;
    }

    if (matches.length > 1) {
      issues.push(this.makeIssue(sheetName, null, null, 'DUPLICATE_SHEET_NAME', 'BLOCKER', `Duplicate sheet name after normalization: ${matches.join(', ')}`, matches.join(', '), normalized));
      return null;
    }

    const worksheet = workbook.Sheets[matches[0] ?? sheetName];
    if (!worksheet) {
      issues.push(this.makeIssue(sheetName, null, null, 'MISSING_SHEET', 'BLOCKER', `Missing required sheet: ${sheetName}`, null, null));
      return null;
    }

    return worksheet;
  }

  private inspectZip(buffer: Buffer): ZipInspectionResult {
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
      throw new BadRequestException('El archivo no parece ser un .xlsx válido');
    }

    const eocdOffset = this.findEndOfCentralDirectory(buffer);
    if (eocdOffset === null) {
      throw new UnprocessableEntityException('El archivo ZIP está corrupto o incompleto');
    }

    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

    if (entryCount > ONBOARDING_IMPORT_MAX_ZIP_ENTRIES) {
      throw new PayloadTooLargeException(`El archivo supera el máximo de ${ONBOARDING_IMPORT_MAX_ZIP_ENTRIES} entradas ZIP`);
    }

    if (centralDirectoryOffset + centralDirectorySize > buffer.length) {
      throw new UnprocessableEntityException('El archivo ZIP está truncado');
    }

    let offset = centralDirectoryOffset;
    let totalUncompressed = 0;
    let totalCompressed = 0;
    let sheetEntries = 0;

    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > buffer.length) {
        throw new UnprocessableEntityException('El archivo ZIP está truncado');
      }

      const signature = buffer.readUInt32LE(offset);
      if (signature !== 0x02014b50) {
        throw new UnprocessableEntityException('El archivo ZIP está corrupto');
      }

      const compressedSize = buffer.readUInt32LE(offset + 20);
      const uncompressedSize = buffer.readUInt32LE(offset + 24);
      const fileNameLength = buffer.readUInt16LE(offset + 28);
      const extraFieldLength = buffer.readUInt16LE(offset + 30);
      const fileCommentLength = buffer.readUInt16LE(offset + 32);
      const fileNameStart = offset + 46;
      const fileNameEnd = fileNameStart + fileNameLength;

      if (fileNameEnd > buffer.length) {
        throw new UnprocessableEntityException('El archivo ZIP está truncado');
      }

      const fileName = buffer.toString('utf8', fileNameStart, fileNameEnd);
      if (fileName.includes('..') || fileName.startsWith('/') || fileName.startsWith('\\')) {
        throw new BadRequestException('El archivo contiene rutas inválidas');
      }

      totalCompressed += compressedSize;
      totalUncompressed += uncompressedSize;
      if (fileName.startsWith('xl/worksheets/')) {
        sheetEntries += 1;
      }

      offset = fileNameEnd + extraFieldLength + fileCommentLength;
    }

    if (sheetEntries > ONBOARDING_IMPORT_MAX_SHEETS) {
      throw new PayloadTooLargeException(`El archivo supera el máximo de ${ONBOARDING_IMPORT_MAX_SHEETS} hojas`);
    }

    if (totalUncompressed > ONBOARDING_IMPORT_MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new PayloadTooLargeException(
        `El archivo descomprimido supera el máximo de ${ONBOARDING_IMPORT_MAX_ZIP_UNCOMPRESSED_BYTES} bytes`,
      );
    }

    const ratio = totalCompressed === 0 ? totalUncompressed : totalUncompressed / Math.max(totalCompressed, 1);
    if (ratio > ONBOARDING_IMPORT_MAX_ZIP_RATIO) {
      throw new PayloadTooLargeException('El archivo puede ser un ZIP bomb');
    }

    return { entryCount, uncompressedSize: totalUncompressed, compressedSize: totalCompressed, sheetEntries };
  }

  private findEndOfCentralDirectory(buffer: Buffer): number | null {
    const signature = 0x06054b50;
    const minimumLength = 22;
    const maxCommentLength = 0xffff;
    const startOffset = Math.max(0, buffer.length - minimumLength - maxCommentLength);

    for (let offset = buffer.length - minimumLength; offset >= startOffset; offset -= 1) {
      if (buffer.readUInt32LE(offset) === signature) {
        return offset;
      }
    }

    return null;
  }

  private makeIssue(
    sheet: ImportSheetName,
    row: number | null,
    column: string | null,
    code: string,
    severity: ImportIssueSeverity,
    message: string,
    receivedValue: string | null,
    normalizedValue: string | null,
  ): ImportIssueRecord {
    return {
      sheet,
      row,
      column,
      code,
      severity,
      message,
      receivedValue,
      normalizedValue,
    };
  }

  private sanitizeForIssue(value: unknown): string | null {
    return this.normalizer.sanitizeCellValue(value, ONBOARDING_IMPORT_MAX_CELL_TEXT_LENGTH);
  }

  private columnLetter(columnIndex: number): string {
    return XLSX.utils.encode_col(columnIndex);
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
      return error.message || fallback;
    }

    return fallback;
  }
}
