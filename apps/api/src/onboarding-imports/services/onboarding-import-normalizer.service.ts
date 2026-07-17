import { BadRequestException, Injectable } from '@nestjs/common';
import { ONBOARDING_IMPORT_ALLOWED_BOOLEAN_VALUES, ONBOARDING_IMPORT_ALLOWED_CURRENCIES, ONBOARDING_IMPORT_ALLOWED_UNIT_TYPES } from '../onboarding-imports.constants';

@Injectable()
export class OnboardingImportNormalizerService {
  normalizeSheetName(value: string): string {
    return value.normalize('NFKC').trim();
  }

  normalizeHeader(value: string): string {
    return this.stripDiacritics(value.normalize('NFKC').trim().toLowerCase()).replace(/\s+/g, '_');
  }

  normalizeText(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const normalized = String(value)
      .normalize('NFKC')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return normalized.length > 0 ? normalized : null;
  }

  normalizeRequiredText(value: unknown, field: string): string {
    const normalized = this.normalizeText(value);
    if (!normalized) {
      throw new BadRequestException(`${field} es obligatorio`);
    }

    return normalized;
  }

  normalizeOptionalText(value: unknown): string | null {
    return this.normalizeText(value);
  }

  normalizeCode(value: unknown, field: string): string {
    const normalized = this.normalizeRequiredText(value, field)
      .replace(/\s+/g, ' ')
      .toUpperCase();

    if (!normalized) {
      throw new BadRequestException(`${field} es obligatorio`);
    }

    return normalized;
  }

  normalizeOptionalCode(value: unknown): string | null {
    const normalized = this.normalizeText(value);
    return normalized ? normalized.replace(/\s+/g, ' ').toUpperCase() : null;
  }

  normalizeEmail(value: unknown): string | null {
    const normalized = this.normalizeOptionalText(value);
    return normalized ? normalized.toLowerCase() : null;
  }

  parseBoolean(value: unknown, field: string): boolean {
    const normalized = this.normalizeText(value)?.toUpperCase();
    if (!normalized) {
      throw new BadRequestException(`${field} es obligatorio`);
    }

    const mapped = ONBOARDING_IMPORT_ALLOWED_BOOLEAN_VALUES.get(normalized);
    if (mapped === undefined) {
      throw new BadRequestException(`${field} debe ser SI o NO`);
    }

    return mapped;
  }

  parseOptionalBoolean(value: unknown): boolean | null {
    const normalized = this.normalizeText(value)?.toUpperCase();
    if (!normalized) {
      return null;
    }

    const mapped = ONBOARDING_IMPORT_ALLOWED_BOOLEAN_VALUES.get(normalized);
    if (mapped === undefined) {
      throw new BadRequestException('Los valores booleanos deben ser SI o NO');
    }

    return mapped;
  }

  parseCurrency(value: unknown, field: string): string {
    const normalized = this.normalizeCode(value, field);
    if (!ONBOARDING_IMPORT_ALLOWED_CURRENCIES.includes(normalized as (typeof ONBOARDING_IMPORT_ALLOWED_CURRENCIES)[number])) {
      throw new BadRequestException(`${field} debe ser uno de ${ONBOARDING_IMPORT_ALLOWED_CURRENCIES.join(', ')}`);
    }

    return normalized;
  }

  parseUnitType(value: unknown, field: string): string {
    const normalized = this.normalizeCode(value, field);
    if (!ONBOARDING_IMPORT_ALLOWED_UNIT_TYPES.includes(normalized as (typeof ONBOARDING_IMPORT_ALLOWED_UNIT_TYPES)[number])) {
      throw new BadRequestException(`${field} debe ser uno de ${ONBOARDING_IMPORT_ALLOWED_UNIT_TYPES.join(', ')}`);
    }

    return normalized;
  }

  parseUnitOccupancyStatus(value: unknown, field: string): 'VACANT' | 'OCCUPIED' {
    const normalized = this.normalizeEnumToken(value, field);

    if (['VACANT', 'VACANTE', 'DESOCUPADA'].includes(normalized)) {
      return 'VACANT';
    }

    if (['OCCUPIED', 'OCUPADA'].includes(normalized)) {
      return 'OCCUPIED';
    }

    throw new BadRequestException(`${field} debe ser VACANTE, DESOCUPADA u OCUPADA`);
  }

  parseRelationRole(value: unknown, field: string): 'OWNER' | 'RESIDENT' {
    const normalized = this.normalizeEnumToken(value, field);

    if (['OWNER', 'PROPIETARIO'].includes(normalized)) {
      return 'OWNER';
    }

    if (['RESIDENT', 'RESIDENTE'].includes(normalized)) {
      return 'RESIDENT';
    }

    throw new BadRequestException(`${field} debe ser OWNER, PROPIETARIO, RESIDENT o RESIDENTE`);
  }

  parseOpeningBalanceKind(value: unknown, field: string): 'DEBITO' | 'CREDITO' {
    const normalized = this.normalizeEnumToken(value, field);

    if (['DEBITO', 'DÉBITO'].includes(normalized)) {
      return 'DEBITO';
    }

    if (['CREDITO', 'CRÉDITO'].includes(normalized)) {
      return 'CREDITO';
    }

    throw new BadRequestException(`${field} debe ser DEBITO, DÉBITO, CREDITO o CRÉDITO`);
  }

  parsePeriod(value: unknown, field: string): string {
    const normalized = this.normalizeRequiredText(value, field);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalized)) {
      throw new BadRequestException(`${field} debe tener formato YYYY-MM`);
    }

    return normalized;
  }

  parseDate(value: unknown, field: string): string {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new BadRequestException(`${field} debe ser una fecha válida`);
      }

      return this.formatDate(value);
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const excelDate = this.excelSerialToDate(value);
      return this.formatDate(excelDate);
    }

    const normalized = this.normalizeRequiredText(value, field);
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(normalized)) {
      throw new BadRequestException(`${field} debe tener formato YYYY-MM-DD`);
    }

    const date = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} debe ser una fecha válida`);
    }

    return normalized;
  }

  parseOptionalDate(value: unknown, field: string): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    return this.parseDate(value, field);
  }

  parseDecimalToMinor(value: unknown, field: string): number {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new BadRequestException(`${field} debe ser un número finito`);
      }

      return this.decimalStringToMinor(value.toString(), field);
    }

    const normalized = this.normalizeRequiredText(value, field);
    return this.decimalStringToMinor(normalized, field);
  }

  parseOptionalDecimalToMinor(value: unknown, field: string): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    return this.parseDecimalToMinor(value, field);
  }

  sanitizeFileName(value: string): string {
    const normalized = this.normalizeText(value) ?? 'import.xlsx';
    return normalized
      .replace(/[\\/]/g, '_')
      .replace(/[:*?"<>|]/g, '_')
      .replace(/\.+/g, '.')
      .slice(0, 180);
  }

  sanitizeCellValue(value: unknown, maxLength: number = 250): string | null {
    const normalized = this.normalizeText(value);
    if (!normalized) {
      return null;
    }

    return normalized.slice(0, maxLength);
  }

  private stripDiacritics(value: string): string {
    return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '');
  }

  private normalizeEnumToken(value: unknown, field: string): string {
    const normalized = this.normalizeRequiredText(value, field);
    return this.stripDiacritics(normalized).normalize('NFKC').replace(/\s+/g, ' ').toUpperCase();
  }

  private decimalStringToMinor(value: string, field: string): number {
    const sanitized = value
      .trim()
      .replace(/\s+/g, '')
      .replace(/[^\d,.-]/g, '');

    if (!sanitized) {
      throw new BadRequestException(`${field} debe ser un importe válido`);
    }

    const negative = sanitized.startsWith('-');
    const unsigned = negative ? sanitized.slice(1) : sanitized;

    const normalized = this.normalizeDecimalSeparator(unsigned);
    const match = normalized.match(/^(\d+)(?:\.(\d{1,}))?$/);
    if (!match) {
      throw new BadRequestException(`${field} debe ser un importe válido`);
    }

    const integerPart = match[1] ?? '0';
    const fractionPart = (match[2] ?? '').padEnd(2, '0').slice(0, 2);
    const cents = Number.parseInt(integerPart, 10) * 100 + Number.parseInt(fractionPart, 10);

    if (!Number.isFinite(cents)) {
      throw new BadRequestException(`${field} es demasiado grande`);
    }

    return negative ? -cents : cents;
  }

  private normalizeDecimalSeparator(value: string): string {
    const hasComma = value.includes(',');
    const hasDot = value.includes('.');

    if (hasComma && hasDot) {
      return value.lastIndexOf(',') > value.lastIndexOf('.')
        ? value.replace(/\./g, '').replace(',', '.')
        : value.replace(/,/g, '');
    }

    if (hasComma) {
      return value.replace(',', '.');
    }

    return value;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private excelSerialToDate(serial: number): Date {
    const days = Math.floor(serial);
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + days * millisecondsPerDay);
  }
}
