import * as XLSX from 'xlsx';
import { unzipSync, strFromU8 } from 'fflate';
import { OnboardingImportTemplateService } from './onboarding-import-template.service';
import {
  ONBOARDING_IMPORT_SCHEMA_VERSION,
  ONBOARDING_IMPORT_TEMPLATE_CONTENT_TYPE,
  ONBOARDING_IMPORT_TEMPLATE_FILENAME,
} from '../onboarding-imports.constants';

const SHEET_NAMES = [
  'Instrucciones',
  'Diccionario_de_Datos',
  'Catalogos',
  'Ejemplos',
  'Edificios',
  'Unidades',
  'Personas',
  'Relaciones_Unidad',
  'Saldos_Iniciales',
];

describe('OnboardingImportTemplateService', () => {
  it('builds the localized template workbook with the expected sheets, headers, validations and examples', () => {
    const service = new OnboardingImportTemplateService();
    const buffer = service.createTemplateBuffer();
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const archive = unzipSync(buffer);

    expect(service.getTemplateFileName()).toBe(ONBOARDING_IMPORT_TEMPLATE_FILENAME);
    expect(service.getTemplateContentType()).toBe(ONBOARDING_IMPORT_TEMPLATE_CONTENT_TYPE);
    expect(service.getSchemaVersion()).toBe(ONBOARDING_IMPORT_SCHEMA_VERSION);
    expect(workbook.SheetNames).toEqual(SHEET_NAMES);

    const instructionsSheet = workbook.Sheets['Instrucciones'];
    const buildingsSheet = workbook.Sheets['Edificios'];
    const unitsSheet = workbook.Sheets['Unidades'];
    const peopleSheet = workbook.Sheets['Personas'];
    const relationsSheet = workbook.Sheets['Relaciones_Unidad'];
    const openingBalancesSheet = workbook.Sheets['Saldos_Iniciales'];
    const examplesSheet = workbook.Sheets['Ejemplos'];

    if (!instructionsSheet || !buildingsSheet || !unitsSheet || !peopleSheet || !relationsSheet || !openingBalancesSheet || !examplesSheet) {
      throw new Error('Localized template sheets are missing');
    }

    const instructions = XLSX.utils.sheet_to_json(instructionsSheet, {
      header: 1,
      raw: false,
    });
    expect(String(instructions[0]?.[0] ?? '')).toContain('Plantilla oficial de importación inicial de BuildingOS');
    expect(String(instructions[0]?.[1] ?? '')).toContain(ONBOARDING_IMPORT_SCHEMA_VERSION);

    const buildings = XLSX.utils.sheet_to_json(buildingsSheet, {
      header: 1,
      raw: false,
    });
    const units = XLSX.utils.sheet_to_json(unitsSheet, {
      header: 1,
      raw: false,
    });
    const people = XLSX.utils.sheet_to_json(peopleSheet, {
      header: 1,
      raw: false,
    });
    const relations = XLSX.utils.sheet_to_json(relationsSheet, {
      header: 1,
      raw: false,
    });
    const openingBalances = XLSX.utils.sheet_to_json(openingBalancesSheet, {
      header: 1,
      raw: false,
    });
    const examples = XLSX.utils.sheet_to_json(examplesSheet, {
      header: 1,
      raw: false,
      defval: null,
    });

    expect(buildings).toEqual([['codigo', 'nombre', 'direccion']]);
    expect(units[0]).toEqual(['edificio_codigo', 'codigo', 'etiqueta', 'tipo', 'm2', 'facturacion', 'estado_ocupacion', 'categoria_nombre', 'coeficiente']);
    expect(people).toEqual([['persona_codigo', 'nombre', 'email', 'telefono', 'documento']]);
    expect(relations).toEqual([['persona_codigo', 'edificio_codigo', 'unidad_codigo', 'rol', 'principal', 'fecha_inicio']]);
    expect(openingBalances).toEqual([['edificio_codigo', 'unidad_codigo', 'periodo', 'concepto', 'monto', 'moneda', 'vencimiento', 'tipo']]);

    const flattenedExamples = examples.map((row) => row.map((value) => String(value ?? '')));
    expect(flattenedExamples).toEqual(expect.arrayContaining([
      ['Edificios', '', '', '', '', '', '', '', ''],
      ['codigo', 'nombre', 'direccion', '', '', '', '', '', ''],
      ['A', 'Torre A', 'Av. Principal 123', '', '', '', '', '', ''],
      ['Unidades', '', '', '', '', '', '', '', ''],
      ['edificio_codigo', 'codigo', 'etiqueta', 'tipo', 'm2', 'facturacion', 'estado_ocupacion', 'categoria_nombre', 'coeficiente'],
      ['A', 'A-01-01', 'Apartamento 1', 'APARTAMENTO', '72.5', 'SI', 'OCUPADA', 'Standard', '1'],
      ['A', 'A-01-02', 'Apartamento 2', 'APARTAMENTO', '68', 'SI', 'DESOCUPADA', 'Standard', '1.25'],
      ['Personas', '', '', '', '', '', '', '', ''],
      ['persona_codigo', 'nombre', 'email', 'telefono', 'documento', '', '', '', ''],
      ['P-001', 'Ana Pérez', 'ana.perez@example.com', '+58 412 1234567', 'V-12345678', '', '', '', ''],
      ['Relaciones_Unidad', '', '', '', '', '', '', '', ''],
      ['persona_codigo', 'edificio_codigo', 'unidad_codigo', 'rol', 'principal', 'fecha_inicio', '', '', ''],
      ['P-001', 'A', 'A-01-01', 'PROPIETARIO', 'SI', '2026-01-01', '', '', ''],
      ['Saldos_Iniciales', '', '', '', '', '', '', '', ''],
      ['edificio_codigo', 'unidad_codigo', 'periodo', 'concepto', 'monto', 'moneda', 'vencimiento', 'tipo', ''],
      ['A', 'A-01-01', '2026-01', 'Saldo inicial', '15000', 'ARS', '2026-01-15', 'DÉBITO', ''],
    ]));

    expect(strFromU8(archive['xl/styles.xml'])).toContain('cellXfs count="4"');
    expect(strFromU8(archive['xl/worksheets/sheet1.xml'])).toContain('pane ySplit="1"');
    expect(strFromU8(archive['xl/worksheets/sheet6.xml'])).toContain('dataValidations count="3"');
    expect(strFromU8(archive['xl/worksheets/sheet6.xml'])).toContain('DESOCUPADA');
    expect(strFromU8(archive['xl/worksheets/sheet8.xml'])).toContain('dataValidations count="2"');
    expect(strFromU8(archive['xl/worksheets/sheet9.xml'])).toContain('dataValidations count="2"');
  });
});
