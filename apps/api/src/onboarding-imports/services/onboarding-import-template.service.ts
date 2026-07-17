import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import {
  ONBOARDING_IMPORT_ALLOWED_CURRENCIES,
  ONBOARDING_IMPORT_ALLOWED_UNIT_TYPES,
  ONBOARDING_IMPORT_TEMPLATE_CONTENT_TYPE,
  ONBOARDING_IMPORT_TEMPLATE_FILENAME,
  ONBOARDING_IMPORT_SCHEMA_VERSION,
} from '../onboarding-imports.constants';

interface WorksheetWithMeta extends XLSX.WorkSheet {
  '!freeze'?: { xSplit: number; ySplit: number; topLeftCell: string; activePane: string; state: string };
  '!protect'?: Record<string, unknown>;
}

interface DataValidationRule {
  readonly ref: string;
  readonly values: readonly string[];
  readonly promptTitle: string;
  readonly prompt: string;
  readonly errorTitle: string;
  readonly error: string;
}

interface SheetPatchConfig {
  readonly styleRows?: Record<number, number>;
  readonly freezeTopRow?: boolean;
  readonly validations?: readonly DataValidationRule[];
}

interface SheetSpec {
  readonly name: string;
  readonly worksheet: WorksheetWithMeta;
}

const TEMPLATE_SHEETS = {
  instructions: 'Instrucciones',
  dictionary: 'Diccionario_de_Datos',
  catalogs: 'Catalogos',
  examples: 'Ejemplos',
  buildings: 'Edificios',
  units: 'Unidades',
  people: 'Personas',
  relations: 'Relaciones_Unidad',
  openingBalances: 'Saldos_Iniciales',
} as const;

const DATA_SHEET_COLUMNS = {
  buildings: ['codigo', 'nombre', 'direccion'],
  units: ['edificio_codigo', 'codigo', 'etiqueta', 'tipo', 'm2', 'facturacion', 'estado_ocupacion', 'categoria_nombre', 'coeficiente'],
  people: ['persona_codigo', 'nombre', 'email', 'telefono', 'documento'],
  relations: ['persona_codigo', 'edificio_codigo', 'unidad_codigo', 'rol', 'principal', 'fecha_inicio'],
  openingBalances: ['edificio_codigo', 'unidad_codigo', 'periodo', 'concepto', 'monto', 'moneda', 'vencimiento', 'tipo'],
} as const;

@Injectable()
export class OnboardingImportTemplateService {
  createTemplateBuffer(): Buffer {
    const workbook = XLSX.utils.book_new();

    const sheets = [
      this.createInstructionsSheet(),
      this.createDictionarySheet(),
      this.createCatalogsSheet(),
      this.createExamplesSheet(),
      this.createBuildingsSheet(),
      this.createUnitsSheet(),
      this.createPeopleSheet(),
      this.createRelationsSheet(),
      this.createOpeningBalancesSheet(),
    ];

    for (const { name, worksheet } of sheets) {
      XLSX.utils.book_append_sheet(workbook, worksheet, name);
    }

    const baseBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
    return this.decorateWorkbookBuffer(baseBuffer);
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

  private createInstructionsSheet(): SheetSpec {
    const rows = [
      ['Plantilla oficial de importación inicial de BuildingOS', `Versión de esquema: ${ONBOARDING_IMPORT_SCHEMA_VERSION}`],
      ['Complete solo las hojas de datos y conserve los encabezados exactamente como aparecen.'],
      ['No cambie el nombre, el orden ni la cantidad de hojas.'],
      ['Las hojas Diccionario_de_Datos, Catalogos y Ejemplos son de apoyo y no se completan manualmente.'],
      ['Los códigos deben escribirse en mayúsculas y sin espacios innecesarios.'],
      ['Los valores booleanos usan SI / NO.'],
      ['Relaciones_Unidad: rol acepta OWNER / PROPIETARIO / RESIDENT / RESIDENTE y se normaliza internamente.'],
      ['Unidades: estado_ocupacion acepta VACANTE / DESOCUPADA / OCUPADA y se normaliza a VACANT / OCCUPIED.'],
      ['Saldos_Iniciales: tipo acepta DEBITO / DÉBITO / CREDITO / CRÉDITO y se normaliza internamente.'],
      ['Orden recomendado: Edificios → Unidades → Personas → Relaciones_Unidad → Saldos_Iniciales.'],
      ['Si una plantilla antigua no trae estado_ocupacion, el backend conserva compatibilidad usando facturacion como respaldo.'],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(rows) as WorksheetWithMeta;
    worksheet['!cols'] = [{ wch: 74 }, { wch: 28 }];
    worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    worksheet['!protect'] = { selectLockedCells: false, selectUnlockedCells: true };
    return { name: TEMPLATE_SHEETS.instructions, worksheet };
  }

  private createDictionarySheet(): SheetSpec {
    const rows = [
      ['Diccionario de datos', 'Contratos y reglas por hoja'],
      ['Hoja', 'Columna', 'Obligatorio', 'Tipo', 'Valores permitidos', 'Descripción'],
      ['Edificios', 'codigo', 'Sí', 'Texto', 'Código único', 'Identificador del edificio dentro del tenant.'],
      ['Edificios', 'nombre', 'Sí', 'Texto', '—', 'Nombre visible del edificio.'],
      ['Edificios', 'direccion', 'Sí', 'Texto', '—', 'Dirección postal del edificio.'],
      ['Unidades', 'edificio_codigo', 'Sí', 'Código', 'Debe existir en Edificios', 'Código del edificio al que pertenece la unidad.'],
      ['Unidades', 'codigo', 'Sí', 'Código', 'Único por edificio', 'Código de la unidad.'],
      ['Unidades', 'etiqueta', 'No', 'Texto', '—', 'Etiqueta o nombre corto de la unidad.'],
      ['Unidades', 'tipo', 'Sí', 'Catálogo', ONBOARDING_IMPORT_ALLOWED_UNIT_TYPES.join(', '), 'Tipo físico o funcional de la unidad.'],
      ['Unidades', 'm2', 'No', 'Número decimal', '—', 'Metros cuadrados de la unidad.'],
      ['Unidades', 'facturacion', 'Sí', 'Booleano', 'SI / NO', 'Indica si la unidad participa en prorrateo.'],
      ['Unidades', 'estado_ocupacion', 'No en archivos antiguos / sí en la plantilla nueva', 'Catálogo', 'VACANTE / DESOCUPADA / OCUPADA', 'Estado de ocupación visible; el backend mantiene compatibilidad si falta.'],
      ['Unidades', 'categoria_nombre', 'No', 'Texto', '—', 'Nombre de la categoría de prorrateo.'],
      ['Unidades', 'coeficiente', 'No', 'Número decimal', 'Mayor que 0', 'Coeficiente de prorrateo de la unidad.'],
      ['Personas', 'persona_codigo', 'Sí', 'Código', 'Único por archivo', 'Código estable de la persona.'],
      ['Personas', 'nombre', 'Sí', 'Texto', '—', 'Nombre completo de la persona.'],
      ['Personas', 'email', 'No', 'Email', '—', 'Correo electrónico de contacto.'],
      ['Personas', 'telefono', 'No', 'Texto', '—', 'Teléfono de contacto.'],
      ['Personas', 'documento', 'No', 'Texto', '—', 'Documento de identidad.'],
      ['Relaciones_Unidad', 'persona_codigo', 'Sí', 'Código', 'Debe existir en Personas', 'Persona vinculada a la unidad.'],
      ['Relaciones_Unidad', 'edificio_codigo', 'Sí', 'Código', 'Debe existir en Edificios', 'Edificio de la relación.'],
      ['Relaciones_Unidad', 'unidad_codigo', 'Sí', 'Código', 'Debe existir en Unidades', 'Unidad de la relación.'],
      ['Relaciones_Unidad', 'rol', 'Sí', 'Catálogo', 'OWNER / PROPIETARIO / RESIDENT / RESIDENTE', 'Rol del vínculo; se normaliza a OWNER o RESIDENT.'],
      ['Relaciones_Unidad', 'principal', 'Sí', 'Booleano', 'SI / NO', 'Marca al ocupante principal de la unidad.'],
      ['Relaciones_Unidad', 'fecha_inicio', 'Sí', 'Fecha', 'YYYY-MM-DD', 'Fecha de inicio de la relación.'],
      ['Saldos_Iniciales', 'edificio_codigo', 'Sí', 'Código', 'Debe existir en Edificios', 'Edificio al que pertenece el saldo inicial.'],
      ['Saldos_Iniciales', 'unidad_codigo', 'Sí', 'Código', 'Debe existir en Unidades', 'Unidad a la que se aplica el saldo inicial.'],
      ['Saldos_Iniciales', 'periodo', 'Sí', 'Periodo', 'YYYY-MM', 'Período contable.'],
      ['Saldos_Iniciales', 'concepto', 'Sí', 'Texto', '—', 'Concepto del cargo o ajuste inicial.'],
      ['Saldos_Iniciales', 'monto', 'Sí', 'Número decimal', 'Mayor que 0', 'Importe del cargo en la moneda del tenant.'],
      ['Saldos_Iniciales', 'moneda', 'Sí', 'Catálogo', ONBOARDING_IMPORT_ALLOWED_CURRENCIES.join(', '), 'Moneda del cargo.'],
      ['Saldos_Iniciales', 'vencimiento', 'Sí', 'Fecha', 'YYYY-MM-DD', 'Fecha de vencimiento.'],
      ['Saldos_Iniciales', 'tipo', 'Sí', 'Catálogo', 'DEBITO / DÉBITO / CREDITO / CRÉDITO', 'Tipo técnico del saldo inicial; se normaliza a DEBITO o CREDITO.'],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(rows) as WorksheetWithMeta;
    worksheet['!cols'] = [
      { wch: 24 },
      { wch: 22 },
      { wch: 30 },
      { wch: 18 },
      { wch: 34 },
      { wch: 72 },
    ];
    worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
    worksheet['!protect'] = { selectLockedCells: false, selectUnlockedCells: true };
    return { name: TEMPLATE_SHEETS.dictionary, worksheet };
  }

  private createCatalogsSheet(): SheetSpec {
    const rows = [
      ['Catálogos de valores', 'Valores visibles y normalización interna'],
      ['Catálogo', 'Valor visible', 'Valor normalizado', 'Uso'],
      ['Booleanos', 'SI', 'true', 'Campos SI/NO'],
      ['Booleanos', 'NO', 'false', 'Campos SI/NO'],
      ['Tipos de unidad', 'APARTAMENTO', 'APARTAMENTO', 'Unidades.tipo'],
      ['Tipos de unidad', 'CASA', 'CASA', 'Unidades.tipo'],
      ['Tipos de unidad', 'OFICINA', 'OFICINA', 'Unidades.tipo'],
      ['Tipos de unidad', 'DEPOSITO', 'DEPOSITO', 'Unidades.tipo'],
      ['Tipos de unidad', 'ESTACIONAMIENTO', 'ESTACIONAMIENTO', 'Unidades.tipo'],
      ['Estado de ocupación', 'VACANTE', 'VACANT', 'Unidades.estado_ocupacion'],
      ['Estado de ocupación', 'DESOCUPADA', 'VACANT', 'Unidades.estado_ocupacion'],
      ['Estado de ocupación', 'OCUPADA', 'OCCUPIED', 'Unidades.estado_ocupacion'],
      ['Roles de relación', 'OWNER / PROPIETARIO', 'OWNER', 'Relaciones_Unidad.rol'],
      ['Roles de relación', 'RESIDENT / RESIDENTE', 'RESIDENT', 'Relaciones_Unidad.rol'],
      ['Tipos de saldo', 'DEBITO / DÉBITO', 'DEBITO', 'Saldos_Iniciales.tipo'],
      ['Tipos de saldo', 'CREDITO / CRÉDITO', 'CREDITO', 'Saldos_Iniciales.tipo'],
      ['Monedas', 'ARS', 'ARS', 'Saldos_Iniciales.moneda'],
      ['Monedas', 'VES', 'VES', 'Saldos_Iniciales.moneda'],
      ['Monedas', 'USD', 'USD', 'Saldos_Iniciales.moneda'],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(rows) as WorksheetWithMeta;
    worksheet['!cols'] = [
      { wch: 24 },
      { wch: 28 },
      { wch: 24 },
      { wch: 34 },
    ];
    worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    worksheet['!protect'] = { selectLockedCells: false, selectUnlockedCells: true };
    return { name: TEMPLATE_SHEETS.catalogs, worksheet };
  }

  private createExamplesSheet(): SheetSpec {
    const rows = [
      ['Ejemplos de carga', 'Datos ficticios de referencia'],
      ['Este bloque muestra un ejemplo por cada hoja de datos. No use estos valores en producción.'],
      ['Edificios'],
      ['codigo', 'nombre', 'direccion'],
      ['A', 'Torre A', 'Av. Principal 123'],
      [],
      ['Unidades'],
      ['edificio_codigo', 'codigo', 'etiqueta', 'tipo', 'm2', 'facturacion', 'estado_ocupacion', 'categoria_nombre', 'coeficiente'],
      ['A', 'A-01-01', 'Apartamento 1', 'APARTAMENTO', 72.5, 'SI', 'OCUPADA', 'Standard', 1],
      ['A', 'A-01-02', 'Apartamento 2', 'APARTAMENTO', 68, 'SI', 'DESOCUPADA', 'Standard', 1.25],
      [],
      ['Personas'],
      ['persona_codigo', 'nombre', 'email', 'telefono', 'documento'],
      ['P-001', 'Ana Pérez', 'ana.perez@example.com', '+58 412 1234567', 'V-12345678'],
      [],
      ['Relaciones_Unidad'],
      ['persona_codigo', 'edificio_codigo', 'unidad_codigo', 'rol', 'principal', 'fecha_inicio'],
      ['P-001', 'A', 'A-01-01', 'PROPIETARIO', 'SI', '2026-01-01'],
      [],
      ['Saldos_Iniciales'],
      ['edificio_codigo', 'unidad_codigo', 'periodo', 'concepto', 'monto', 'moneda', 'vencimiento', 'tipo'],
      ['A', 'A-01-01', '2026-01', 'Saldo inicial', 15000, 'ARS', '2026-01-15', 'DÉBITO'],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(rows) as WorksheetWithMeta;
    worksheet['!cols'] = [
      { wch: 20 },
      { wch: 30 },
      { wch: 30 },
      { wch: 18 },
      { wch: 12 },
      { wch: 12 },
      { wch: 20 },
      { wch: 24 },
      { wch: 14 },
    ];
    worksheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
      { s: { r: 6, c: 0 }, e: { r: 6, c: 8 } },
      { s: { r: 10, c: 0 }, e: { r: 10, c: 4 } },
      { s: { r: 14, c: 0 }, e: { r: 14, c: 5 } },
      { s: { r: 18, c: 0 }, e: { r: 18, c: 7 } },
    ];
    worksheet['!protect'] = { selectLockedCells: false, selectUnlockedCells: true };
    return { name: TEMPLATE_SHEETS.examples, worksheet };
  }

  private createBuildingsSheet(): SheetSpec {
    return this.createDataSheet(TEMPLATE_SHEETS.buildings, DATA_SHEET_COLUMNS.buildings, [
      'Código único del edificio dentro del tenant.',
      'Nombre visible del edificio.',
      'Dirección postal del edificio.',
    ], [24, 36, 42], {
      freezeTopRow: true,
      styleRows: { 1: 1 },
    });
  }

  private createUnitsSheet(): SheetSpec {
    return this.createDataSheet(TEMPLATE_SHEETS.units, DATA_SHEET_COLUMNS.units, [
      'Debe coincidir con Edificios.codigo.',
      'Código único de la unidad dentro del edificio.',
      'Etiqueta visible de la unidad.',
      'Valores permitidos: APARTAMENTO, CASA, OFICINA, DEPOSITO, ESTACIONAMIENTO.',
      'Metros cuadrados de la unidad.',
      'SI si participa en prorrateo; NO si no.',
      'VACANTE, DESOCUPADA u OCUPADA. Si falta por compatibilidad, el backend usa facturacion como respaldo.',
      'Nombre de la categoría de prorrateo.',
      'Coeficiente numérico de prorrateo.',
    ], [22, 18, 28, 22, 12, 18, 24, 28, 16], {
      freezeTopRow: true,
      styleRows: { 1: 1 },
      validations: [
        this.buildListValidation('D2:D5001', ONBOARDING_IMPORT_ALLOWED_UNIT_TYPES, 'Tipo de unidad', 'Seleccione un tipo permitido.', 'Valor inválido', 'Seleccione uno de los valores permitidos.'),
        this.buildListValidation('F2:F5001', ['SI', 'NO'], 'Facturación', 'Use SI o NO.', 'Valor inválido', 'Use SI o NO.'),
        this.buildListValidation('G2:G5001', ['VACANTE', 'DESOCUPADA', 'OCUPADA'], 'Estado de ocupación', 'Use VACANTE, DESOCUPADA u OCUPADA.', 'Valor inválido', 'Use VACANTE, DESOCUPADA u OCUPADA.'),
      ],
    });
  }

  private createPeopleSheet(): SheetSpec {
    return this.createDataSheet(TEMPLATE_SHEETS.people, DATA_SHEET_COLUMNS.people, [
      'Código estable de la persona.',
      'Nombre completo de la persona.',
      'Correo electrónico de contacto.',
      'Teléfono de contacto.',
      'Documento de identidad.',
    ], [20, 30, 32, 20, 18], {
      freezeTopRow: true,
      styleRows: { 1: 1 },
    });
  }

  private createRelationsSheet(): SheetSpec {
    return this.createDataSheet(TEMPLATE_SHEETS.relations, DATA_SHEET_COLUMNS.relations, [
      'Persona vinculada a la unidad.',
      'Edificio de la relación.',
      'Unidad de la relación.',
      'Valores permitidos: OWNER, PROPIETARIO, RESIDENT, RESIDENTE.',
      'SI identifica al ocupante principal.',
      'Fecha de inicio de la relación.',
    ], [20, 22, 22, 28, 16, 18], {
      freezeTopRow: true,
      styleRows: { 1: 1 },
      validations: [
        this.buildListValidation('D2:D5001', ['OWNER', 'PROPIETARIO', 'RESIDENT', 'RESIDENTE'], 'Rol', 'Seleccione OWNER, PROPIETARIO, RESIDENT o RESIDENTE.', 'Valor inválido', 'Seleccione un rol permitido.'),
        this.buildListValidation('E2:E5001', ['SI', 'NO'], 'Principal', 'Use SI o NO.', 'Valor inválido', 'Use SI o NO.'),
      ],
    });
  }

  private createOpeningBalancesSheet(): SheetSpec {
    return this.createDataSheet(TEMPLATE_SHEETS.openingBalances, DATA_SHEET_COLUMNS.openingBalances, [
      'Edificio al que pertenece el saldo inicial.',
      'Unidad a la que se aplica el saldo inicial.',
      'Período contable en formato YYYY-MM.',
      'Concepto del cargo o ajuste inicial.',
      'Importe del cargo en la moneda del tenant.',
      `Moneda del cargo. Valores permitidos: ${ONBOARDING_IMPORT_ALLOWED_CURRENCIES.join(', ')}.`,
      'Fecha de vencimiento.',
      'Tipo técnico del saldo inicial. Se normaliza desde DEBITO / DÉBITO / CREDITO / CRÉDITO.',
    ], [20, 20, 14, 32, 16, 14, 16, 18], {
      freezeTopRow: true,
      styleRows: { 1: 1 },
      validations: [
        this.buildListValidation('F2:F5001', ONBOARDING_IMPORT_ALLOWED_CURRENCIES, 'Moneda', 'Seleccione una moneda permitida.', 'Valor inválido', 'Seleccione una moneda permitida.'),
        this.buildListValidation('H2:H5001', ['DEBITO', 'DÉBITO', 'CREDITO', 'CRÉDITO'], 'Tipo', 'Seleccione DEBITO o CREDITO.', 'Valor inválido', 'Seleccione DEBITO o CREDITO.'),
      ],
    });
  }

  private createDataSheet(
    name: string,
    headers: readonly string[],
    comments: readonly string[],
    widths: readonly number[],
    patch: SheetPatchConfig,
  ): SheetSpec {
    const rows: string[][] = [headers.slice()];
    const worksheet = XLSX.utils.aoa_to_sheet(rows) as WorksheetWithMeta;
    worksheet['!cols'] = widths.map((width) => ({ wch: width }));
    worksheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }),
    };
    this.attachHeaderComments(worksheet, comments);
    return { name, worksheet: this.applyWorksheetMetadata(worksheet, patch) };
  }

  private applyWorksheetMetadata(worksheet: WorksheetWithMeta, patch: SheetPatchConfig): WorksheetWithMeta {
    if (patch.freezeTopRow) {
      worksheet['!freeze'] = {
        xSplit: 0,
        ySplit: 1,
        topLeftCell: 'A2',
        activePane: 'bottomLeft',
        state: 'frozen',
      };
    }

    return worksheet;
  }

  private attachHeaderComments(worksheet: WorksheetWithMeta, comments: readonly string[]): void {
    comments.forEach((comment, index) => {
      const address = XLSX.utils.encode_cell({ r: 0, c: index });
      const cell = worksheet[address] as XLSX.CellObject | undefined;
      if (!cell || !comment) {
        return;
      }

      cell.c = [{ a: 'BuildingOS', t: comment }];
    });
  }

  private decorateWorkbookBuffer(buffer: Buffer): Buffer {
    const entries = unzipSync(buffer);
    entries['xl/styles.xml'] = strToU8(this.buildStylesXml());

    const patchConfigs: Array<[string, SheetPatchConfig]> = [
      ['xl/worksheets/sheet1.xml', { styleRows: { 1: 2 }, freezeTopRow: true }],
      ['xl/worksheets/sheet2.xml', { styleRows: { 1: 2, 2: 1 }, freezeTopRow: true }],
      ['xl/worksheets/sheet3.xml', { styleRows: { 1: 2, 2: 1 }, freezeTopRow: true }],
      ['xl/worksheets/sheet4.xml', { styleRows: { 1: 2, 3: 3, 4: 1, 7: 3, 8: 1, 11: 3, 12: 1, 15: 3, 16: 1, 19: 3, 20: 1 }, freezeTopRow: true }],
      ['xl/worksheets/sheet5.xml', { styleRows: { 1: 1 }, freezeTopRow: true }],
      ['xl/worksheets/sheet6.xml', { styleRows: { 1: 1 }, freezeTopRow: true, validations: this.createUnitsValidations() }],
      ['xl/worksheets/sheet7.xml', { styleRows: { 1: 1 }, freezeTopRow: true }],
      ['xl/worksheets/sheet8.xml', { styleRows: { 1: 1 }, freezeTopRow: true, validations: this.createRelationsValidations() }],
      ['xl/worksheets/sheet9.xml', { styleRows: { 1: 1 }, freezeTopRow: true, validations: this.createOpeningBalanceValidations() }],
    ];

    for (const [path, patch] of patchConfigs) {
      const current = entries[path];
      if (!current) {
        continue;
      }

      const patched = this.patchWorksheetXml(strFromU8(current), patch);
      entries[path] = strToU8(patched);
    }

    return Buffer.from(zipSync(entries));
  }

  private patchWorksheetXml(xml: string, patch: SheetPatchConfig): string {
    let patched = xml;

    if (patch.freezeTopRow) {
      patched = this.injectFrozenPane(patched);
    }

    if (patch.styleRows && Object.keys(patch.styleRows).length > 0) {
      patched = this.applyRowStyles(patched, patch.styleRows);
    }

    if (patch.validations && patch.validations.length > 0) {
      patched = this.injectDataValidations(patched, patch.validations);
    }

    return patched;
  }

  private injectFrozenPane(xml: string): string {
    const frozen = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
    const unfrozenPattern = /<sheetViews><sheetView workbookViewId="0"\/><\/sheetViews>/;
    const withExistingFrozenPane = /<sheetViews><sheetView workbookViewId="0">[\s\S]*?<\/sheetView><\/sheetViews>/;

    if (unfrozenPattern.test(xml)) {
      return xml.replace(unfrozenPattern, frozen);
    }

    if (withExistingFrozenPane.test(xml)) {
      return xml.replace(withExistingFrozenPane, frozen);
    }

    return xml;
  }

  private applyRowStyles(xml: string, styleRows: Record<number, number>): string {
    return xml.replace(/<c r="([A-Z]+)(\d+)"([^>]*)>/g, (_match, column: string, rowText: string, attrs: string) => {
      const style = styleRows[Number(rowText)];
      if (style === undefined) {
        return `<c r="${column}${rowText}"${attrs}>`;
      }

      if (/\ss="\d+"/.test(attrs)) {
        return `<c r="${column}${rowText}"${attrs.replace(/\ss="\d+"/, ` s="${style}"`)}>`;
      }

      return `<c r="${column}${rowText}"${attrs} s="${style}">`;
    });
  }

  private injectDataValidations(xml: string, validations: readonly DataValidationRule[]): string {
    const validationXml = [
      `<dataValidations count="${validations.length}">`,
      ...validations.map((validation) => this.buildValidationXml(validation)),
      '</dataValidations>',
    ].join('');

    if (xml.includes('<ignoredErrors>')) {
      return xml.replace('<ignoredErrors>', `${validationXml}<ignoredErrors>`);
    }

    return xml.replace('</worksheet>', `${validationXml}</worksheet>`);
  }

  private buildValidationXml(validation: DataValidationRule): string {
    const listFormula = `"${validation.values.join(',')}"`;

    return [
      `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="${validation.errorTitle}" error="${validation.error}" promptTitle="${validation.promptTitle}" prompt="${validation.prompt}" sqref="${validation.ref}">`,
      `<formula1>${listFormula}</formula1>`,
      '</dataValidation>',
    ].join('');
  }

  private buildStylesXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <numFmts count="0"/>
  <fonts count="3">
    <font>
      <sz val="12"/>
      <color theme="1"/>
      <name val="Calibri"/>
      <family val="2"/>
      <scheme val="minor"/>
    </font>
    <font>
      <b/>
      <sz val="11"/>
      <color rgb="FFFFFF"/>
      <name val="Calibri"/>
      <family val="2"/>
    </font>
    <font>
      <b/>
      <sz val="14"/>
      <color rgb="FFFFFF"/>
      <name val="Calibri"/>
      <family val="2"/>
    </font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="2F75B5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="1F4E78"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="D9E2F3"/></left>
      <right style="thin"><color rgb="D9E2F3"/></right>
      <top style="thin"><color rgb="D9E2F3"/></top>
      <bottom style="thin"><color rgb="D9E2F3"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="left" vertical="center" wrapText="1"/>
    </xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleMedium4"/>
</styleSheet>`;
  }

  private createUnitsValidations(): readonly DataValidationRule[] {
    return [
      this.buildListValidation('D2:D5001', ONBOARDING_IMPORT_ALLOWED_UNIT_TYPES, 'Tipo de unidad', 'Seleccione un valor permitido.', 'Valor inválido', 'Seleccione un valor permitido.'),
      this.buildListValidation('F2:F5001', ['SI', 'NO'], 'Facturación', 'Use SI o NO.', 'Valor inválido', 'Use SI o NO.'),
      this.buildListValidation('G2:G5001', ['VACANTE', 'DESOCUPADA', 'OCUPADA'], 'Estado de ocupación', 'Use VACANTE, DESOCUPADA u OCUPADA.', 'Valor inválido', 'Use VACANTE, DESOCUPADA u OCUPADA.'),
    ];
  }

  private createRelationsValidations(): readonly DataValidationRule[] {
    return [
      this.buildListValidation('D2:D5001', ['OWNER', 'PROPIETARIO', 'RESIDENT', 'RESIDENTE'], 'Rol de relación', 'Seleccione un rol permitido.', 'Valor inválido', 'Seleccione OWNER, PROPIETARIO, RESIDENT o RESIDENTE.'),
      this.buildListValidation('E2:E5001', ['SI', 'NO'], 'Principal', 'Use SI o NO.', 'Valor inválido', 'Use SI o NO.'),
    ];
  }

  private createOpeningBalanceValidations(): readonly DataValidationRule[] {
    return [
      this.buildListValidation('F2:F5001', ONBOARDING_IMPORT_ALLOWED_CURRENCIES, 'Moneda', 'Seleccione una moneda permitida.', 'Valor inválido', 'Seleccione una moneda permitida.'),
      this.buildListValidation('H2:H5001', ['DEBITO', 'DÉBITO', 'CREDITO', 'CRÉDITO'], 'Tipo', 'Seleccione DEBITO o CREDITO.', 'Valor inválido', 'Seleccione DEBITO o CREDITO.'),
    ];
  }

  private buildListValidation(
    ref: string,
    values: readonly string[],
    promptTitle: string,
    prompt: string,
    errorTitle: string,
    error: string,
  ): DataValidationRule {
    return {
      ref,
      values,
      promptTitle,
      prompt,
      errorTitle,
      error,
    };
  }
}
