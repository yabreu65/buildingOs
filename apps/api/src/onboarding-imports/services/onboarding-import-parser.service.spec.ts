import { BadRequestException, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { OnboardingImportNormalizerService } from './onboarding-import-normalizer.service';
import { OnboardingImportParserService } from './onboarding-import-parser.service';
import { ONBOARDING_IMPORT_MAX_ZIP_UNCOMPRESSED_BYTES, ONBOARDING_IMPORT_SHEETS } from '../onboarding-imports.constants';

function buildWorkbook(includeAllSheets = true): Buffer {
  const workbook = XLSX.utils.book_new();

  const buildings = XLSX.utils.aoa_to_sheet([
    ['codigo', 'nombre', 'direccion'],
    ['A', 'Torre A', 'Av. Principal 123'],
  ]);
  const units = XLSX.utils.aoa_to_sheet([
    ['edificio_codigo', 'codigo', 'etiqueta', 'tipo', 'm2', 'facturacion', 'estado_ocupacion', 'categoria_nombre', 'coeficiente'],
    ['A', 'A-01-01', 'Apartamento 1', 'APARTAMENTO', 72.5, 'SI', 'OCUPADA', 'Standard', 1],
  ]);
  const people = XLSX.utils.aoa_to_sheet([
    ['persona_codigo', 'nombre', 'email', 'telefono', 'documento'],
    ['P-001', 'Ana Pérez', 'ana.perez@example.com', '+58 412 1234567', 'V-12345678'],
  ]);
  const relations = XLSX.utils.aoa_to_sheet([
    ['persona_codigo', 'edificio_codigo', 'unidad_codigo', 'rol', 'principal', 'fecha_inicio'],
    ['P-001', 'A', 'A-01-01', 'OWNER', 'SI', '2026-01-01'],
  ]);
  const openingBalances = XLSX.utils.aoa_to_sheet([
    ['edificio_codigo', 'unidad_codigo', 'periodo', 'concepto', 'monto', 'moneda', 'vencimiento', 'tipo'],
    ['A', 'A-01-01', '2026-01', 'Saldo inicial', 15000, 'ARS', '2026-01-15', 'DEBITO'],
  ]);
  const instructions = XLSX.utils.aoa_to_sheet([
    ['BuildingOS import', 'Schema version: v1'],
  ]);

  XLSX.utils.book_append_sheet(workbook, instructions, ONBOARDING_IMPORT_SHEETS.instructions);
  XLSX.utils.book_append_sheet(workbook, buildings, ONBOARDING_IMPORT_SHEETS.buildings);
  XLSX.utils.book_append_sheet(workbook, units, ONBOARDING_IMPORT_SHEETS.units);
  XLSX.utils.book_append_sheet(workbook, people, ONBOARDING_IMPORT_SHEETS.people);
  XLSX.utils.book_append_sheet(workbook, relations, ONBOARDING_IMPORT_SHEETS.relations);
  XLSX.utils.book_append_sheet(workbook, openingBalances, ONBOARDING_IMPORT_SHEETS.openingBalances);

  if (!includeAllSheets) {
    delete workbook.Sheets[ONBOARDING_IMPORT_SHEETS.people];
    workbook.SheetNames = workbook.SheetNames.filter((sheet) => sheet !== ONBOARDING_IMPORT_SHEETS.people);
  }

  const openingBalancesSheet = workbook.Sheets[ONBOARDING_IMPORT_SHEETS.openingBalances]!;
  openingBalancesSheet.E2 = { t: 'n', f: '10000+5000', v: 15000 } as XLSX.CellObject;

  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

function buildLocalizedWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['codigo', 'nombre', 'direccion'],
    ['A', 'Torre A', 'Av. Principal 123'],
  ]), ONBOARDING_IMPORT_SHEETS.instructions);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['codigo', 'nombre', 'direccion'],
    ['A', 'Torre A', 'Av. Principal 123'],
  ]), ONBOARDING_IMPORT_SHEETS.buildings);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['edificio_codigo', 'codigo', 'etiqueta', 'tipo', 'm2', 'facturacion', 'estado_ocupacion', 'categoria_nombre', 'coeficiente'],
    ['A', 'A-01-01', 'Apartamento 1', 'APARTAMENTO', 72.5, 'SI', 'DESOCUPADA', 'Standard', 1],
    ['A', 'A-01-02', 'Apartamento 2', 'APARTAMENTO', 68, 'SI', 'OCUPADA', 'Standard', 1.25],
  ]), ONBOARDING_IMPORT_SHEETS.units);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['persona_codigo', 'nombre', 'email', 'telefono', 'documento'],
    ['P-001', 'Ana Pérez', 'ana.perez@example.com', '+58 412 1234567', 'V-12345678'],
  ]), ONBOARDING_IMPORT_SHEETS.people);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['persona_codigo', 'edificio_codigo', 'unidad_codigo', 'rol', 'principal', 'fecha_inicio'],
    ['P-001', 'A', 'A-01-01', 'PROPIETARIO', 'SI', '2026-01-01'],
    ['P-001', 'A', 'A-01-01', 'RESIDENTE', 'NO', '2026-01-02'],
  ]), ONBOARDING_IMPORT_SHEETS.relations);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['edificio_codigo', 'unidad_codigo', 'periodo', 'concepto', 'monto', 'moneda', 'vencimiento', 'tipo'],
    ['A', 'A-01-01', '2026-01', 'Saldo inicial', 15000, 'ARS', '2026-01-15', 'DÉBITO'],
    ['A', 'A-01-01', '2026-02', 'Saldo inicial', 5000, 'ARS', '2026-02-15', 'CRÉDITO'],
  ]), ONBOARDING_IMPORT_SHEETS.openingBalances);

  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

function inflateDeclaredUncompressedSize(buffer: Buffer, declaredSize: number): Buffer {
  const clone = Buffer.from(buffer);
  const eocdSignature = 0x06054b50;

  for (let offset = clone.length - 22; offset >= 0; offset -= 1) {
    if (clone.readUInt32LE(offset) !== eocdSignature) {
      continue;
    }

    const centralDirectoryOffset = clone.readUInt32LE(offset + 16);
    clone.writeUInt32LE(declaredSize, centralDirectoryOffset + 24);
    return clone;
  }

  throw new Error('Unable to locate EOCD in workbook buffer');
}

describe('OnboardingImportParserService', () => {
  const normalizer = new OnboardingImportNormalizerService();
  const parser = new OnboardingImportParserService(normalizer);

  it('parses a valid workbook and flags formulas as blocked', () => {
    const result = parser.parseWorkbook(buildWorkbook());

    expect(result.data.buildings).toHaveLength(1);
    expect(result.data.units).toHaveLength(1);
    expect(result.data.people).toHaveLength(1);
    expect(result.data.relations).toHaveLength(1);
    expect(result.data.openingBalances).toHaveLength(1);
    expect(result.issues.some((issue) => issue.code === 'FORMULA_NOT_ALLOWED')).toBe(true);
  });

  it('normalizes localized roles, occupancy and balance kinds', () => {
    const result = parser.parseWorkbook(buildLocalizedWorkbook());

    expect(result.data.units.map((row) => row.normalized?.estadoOcupacion)).toEqual(['VACANT', 'OCCUPIED']);
    expect(result.data.relations.map((row) => row.normalized?.rol)).toEqual(['OWNER', 'RESIDENT']);
    expect(result.data.openingBalances.map((row) => row.normalized?.kind)).toEqual(['DEBITO', 'CREDITO']);
  });

  it('reports missing required sheets', () => {
    const result = parser.parseWorkbook(buildWorkbook(false));

    expect(result.issues.some((issue) => issue.code === 'MISSING_SHEET')).toBe(true);
  });

  it('rejects non-xlsx buffers before parsing', () => {
    expect(() => parser.parseWorkbook(Buffer.from('not-an-xlsx'))).toThrow(
      BadRequestException,
    );
  });

  it('rejects truncated zip payloads', () => {
    const buffer = Buffer.alloc(128, 0);
    buffer.writeUInt32LE(0x04034b50, 0);

    expect(() => parser.parseWorkbook(buffer)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects workbooks whose declared uncompressed size exceeds the safety limit', () => {
    const oversizedBuffer = inflateDeclaredUncompressedSize(
      buildWorkbook(),
      ONBOARDING_IMPORT_MAX_ZIP_UNCOMPRESSED_BYTES + 1,
    );

    expect(() => parser.parseWorkbook(oversizedBuffer)).toThrow(
      PayloadTooLargeException,
    );
  });
});
