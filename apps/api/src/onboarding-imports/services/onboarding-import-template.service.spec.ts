import * as XLSX from 'xlsx';
import { OnboardingImportTemplateService } from './onboarding-import-template.service';
import {
  ONBOARDING_IMPORT_SCHEMA_VERSION,
  ONBOARDING_IMPORT_SHEETS,
  ONBOARDING_IMPORT_TEMPLATE_CONTENT_TYPE,
  ONBOARDING_IMPORT_TEMPLATE_FILENAME,
} from '../onboarding-imports.constants';

describe('OnboardingImportTemplateService', () => {
  it('builds the official template workbook with the expected sheets and headers', () => {
    const service = new OnboardingImportTemplateService();
    const buffer = service.createTemplateBuffer();
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    expect(service.getTemplateFileName()).toBe(ONBOARDING_IMPORT_TEMPLATE_FILENAME);
    expect(service.getTemplateContentType()).toBe(ONBOARDING_IMPORT_TEMPLATE_CONTENT_TYPE);
    expect(service.getSchemaVersion()).toBe(ONBOARDING_IMPORT_SCHEMA_VERSION);
    expect(workbook.SheetNames).toEqual([
      ONBOARDING_IMPORT_SHEETS.instructions,
      ONBOARDING_IMPORT_SHEETS.buildings,
      ONBOARDING_IMPORT_SHEETS.units,
      ONBOARDING_IMPORT_SHEETS.people,
      ONBOARDING_IMPORT_SHEETS.relations,
      ONBOARDING_IMPORT_SHEETS.openingBalances,
    ]);

    const buildings = XLSX.utils.sheet_to_json(workbook.Sheets[ONBOARDING_IMPORT_SHEETS.buildings]!, {
      header: 1,
      raw: false,
    }) as string[][];
    expect(buildings[0]).toEqual(['codigo', 'nombre', 'direccion']);

    const instructions = XLSX.utils.sheet_to_json(workbook.Sheets[ONBOARDING_IMPORT_SHEETS.instructions]!, {
      header: 1,
      raw: false,
    }) as string[][];
    expect(String(instructions[0]?.[0] ?? '')).toContain('BuildingOS import');
    expect(String(instructions[0]?.[1] ?? '')).toContain(ONBOARDING_IMPORT_SCHEMA_VERSION);
  });
