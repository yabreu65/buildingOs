import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import {
  ONBOARDING_IMPORT_ALLOWED_CURRENCIES,
  ONBOARDING_IMPORT_ALLOWED_UNIT_TYPES,
  ONBOARDING_IMPORT_SHEETS,
  ONBOARDING_IMPORT_TEMPLATE_FILENAME,
  ONBOARDING_IMPORT_TEMPLATE_CONTENT_TYPE,
  ONBOARDING_IMPORT_SCHEMA_VERSION,
} from '../onboarding-imports.constants';

interface WorksheetWithMeta extends XLSX.WorkSheet {
  '!freeze'?: { xSplit: number; ySplit: number; topLeftCell: string; activePane: string; state: string };
}

@Injectable()
export class OnboardingImportTemplateService {
  createTemplateBuffer(): Buffer {
    const workbook = XLSX.utils.book_new();

    this.addInstructionsSheet(workbook);
    this.addBuildingsSheet(workbook);
    this.addUnitsSheet(workbook);
    this.addPeopleSheet(workbook);
    this.addRelationsSheet(workbook);
    this.addOpeningBalancesSheet(workbook);

    return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  }

  getTemplateFileName(): string {
    return ONBOARDING_IMPORT_TEMPLATE_FILENAME;
  }

  getTemplateContentType(): string {
    return ONBOARDING_IMPORT_TEMPLATE_CONTENT_TYPE;
  }

  getSchemaVersion(): string {
    return ONBOARDING_IMPORT_SCHEMA_VERSION;
  }

  private addInstructionsSheet(workbook: XLSX.WorkBook): void {
    const rows = [
      ['BuildingOS import', `Schema version: ${ONBOARDING_IMPORT_SCHEMA_VERSION}`],
      ['This workbook is the only approved format for the initial onboarding import.'],
      ['Fill the data sheets only; do not rename sheets or headers.'],
      ['All example data is fictitious.'],
      ['Allowed roles: OWNER / RESIDENT.'],
      ['Allowed booleans: SI / NO.'],
      ['Allowed currencies:', ONBOARDING_IMPORT_ALLOWED_CURRENCIES.join(', ')],
      ['Allowed unit types:', ONBOARDING_IMPORT_ALLOWED_UNIT_TYPES.join(', ')],
      ['Sheets to complete:'],
      ['- Edificios'],
      ['- Unidades'],
      ['- Personas'],
      ['- Relaciones_Unidad'],
      ['- Saldos_Iniciales'],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(rows) as WorksheetWithMeta;
    this.setColumnWidths(worksheet, [{ wch: 32 }, { wch: 80 }]);
    this.setHeaderStyle(worksheet, 1, 2);
    this.setFrozenPane(worksheet);
    XLSX.utils.book_append_sheet(workbook, worksheet, ONBOARDING_IMPORT_SHEETS.instructions);
  }

  private addBuildingsSheet(workbook: XLSX.WorkBook): void {
    const headers = ['codigo', 'nombre', 'direccion'];
    const sample = ['A', 'Torre A', 'Av. Principal 123'];
    const worksheet = XLSX.utils.aoa_to_sheet([headers, sample]) as WorksheetWithMeta;
    this.applySheetShape(worksheet, headers.length, 2, [20, 32, 40]);
    XLSX.utils.book_append_sheet(workbook, worksheet, ONBOARDING_IMPORT_SHEETS.buildings);
  }

  private addUnitsSheet(workbook: XLSX.WorkBook): void {
    const headers = [
      'edificio_codigo',
      'codigo',
      'etiqueta',
      'tipo',
      'm2',
      'facturacion',
      'categoria_nombre',
      'coeficiente',
    ];
    const sample = ['A', 'A-01-01', 'Apartamento 1', 'APARTAMENTO', 72.5, 'SI', 'Standard', 1];
    const worksheet = XLSX.utils.aoa_to_sheet([headers, sample]) as WorksheetWithMeta;
    this.applySheetShape(worksheet, headers.length, 2, [18, 16, 24, 18, 12, 14, 24, 14]);
    XLSX.utils.book_append_sheet(workbook, worksheet, ONBOARDING_IMPORT_SHEETS.units);
  }

  private addPeopleSheet(workbook: XLSX.WorkBook): void {
    const headers = ['persona_codigo', 'nombre', 'email', 'telefono', 'documento'];
    const sample = ['P-001', 'Ana Pérez', 'ana.perez@example.com', '+58 412 1234567', 'V-12345678'];
    const worksheet = XLSX.utils.aoa_to_sheet([headers, sample]) as WorksheetWithMeta;
    this.applySheetShape(worksheet, headers.length, 2, [20, 28, 30, 18, 18]);
    XLSX.utils.book_append_sheet(workbook, worksheet, ONBOARDING_IMPORT_SHEETS.people);
  }

  private addRelationsSheet(workbook: XLSX.WorkBook): void {
    const headers = ['persona_codigo', 'edificio_codigo', 'unidad_codigo', 'rol', 'principal', 'fecha_inicio'];
    const sample = ['P-001', 'A', 'A-01-01', 'OWNER', 'SI', '2026-01-01'];
    const worksheet = XLSX.utils.aoa_to_sheet([headers, sample]) as WorksheetWithMeta;
    this.applySheetShape(worksheet, headers.length, 2, [18, 18, 18, 14, 12, 14]);
    XLSX.utils.book_append_sheet(workbook, worksheet, ONBOARDING_IMPORT_SHEETS.relations);
  }

  private addOpeningBalancesSheet(workbook: XLSX.WorkBook): void {
    const headers = [
      'edificio_codigo',
      'unidad_codigo',
      'periodo',
      'concepto',
      'monto',
      'moneda',
      'vencimiento',
      'tipo',
    ];
    const sample = ['A', 'A-01-01', '2026-01', 'Saldo inicial', 15000, 'ARS', '2026-01-15', 'DEBITO'];
    const worksheet = XLSX.utils.aoa_to_sheet([headers, sample]) as WorksheetWithMeta;
    this.applySheetShape(worksheet, headers.length, 2, [18, 18, 14, 30, 14, 12, 14, 12]);
    XLSX.utils.book_append_sheet(workbook, worksheet, ONBOARDING_IMPORT_SHEETS.openingBalances);
  }

  private applySheetShape(
    worksheet: WorksheetWithMeta,
    columnCount: number,
    dataRows: number,
    widths: Array<number>,
  ): void {
    this.setColumnWidths(worksheet, widths.map((wch) => ({ wch })));
    this.setHeaderStyle(worksheet, 1, columnCount);
    this.setAutoFilter(worksheet, columnCount, dataRows);
    this.setFrozenPane(worksheet);
  }

  private setHeaderStyle(worksheet: WorksheetWithMeta, rowNumber: number, columnCount: number): void {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowNumber - 1, c: columnIndex });
      const cell = worksheet[cellAddress] as XLSX.CellObject & { s?: Record<string, unknown> } | undefined;
      if (!cell) {
        continue;
      }

      cell.s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: '1F4E78' } },
        alignment: { vertical: 'center', horizontal: 'center' },
      };
    }
  }

  private setColumnWidths(worksheet: WorksheetWithMeta, widths: Array<{ wch: number }>): void {
    worksheet['!cols'] = widths;
  }

  private setAutoFilter(worksheet: WorksheetWithMeta, columnCount: number, rowCount: number): void {
    worksheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rowCount - 1, c: columnCount - 1 },
      }),
    };
  }

  private setFrozenPane(worksheet: WorksheetWithMeta): void {
    worksheet['!freeze'] = {
      xSplit: 0,
      ySplit: 1,
      topLeftCell: 'A2',
      activePane: 'bottomLeft',
      state: 'frozen',
    };
  }
}
