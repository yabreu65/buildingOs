import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateChargeDto,
  UpdateChargeDto,
  SubmitPaymentDto,
} from './finanzas.dto';

const validate = <T extends object>(cls: new () => T, input: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, input), {
    whitelist: true,
    forbidUnknownValues: true,
  });

describe('3E1 canonical currency DTOs', () => {
  describe('CreateChargeDto.currency', () => {
    const base = {
      unitId: 'unit-1',
      type: 'COMMON_EXPENSE',
      concept: 'Expensas',
      amount: 10000,
      dueDate: '2026-06-10',
    };

    it.each(['USD', 'VES', 'ARS', 'COP'])('accepts canonical %s', (currency) => {
      expect(validate(CreateChargeDto, { ...base, currency })).toHaveLength(0);
    });

    it('rejects absent currency (no silent default)', () => {
      const errors = validate(CreateChargeDto, base);
      expect(errors.map((error) => error.property)).toContain('currency');
    });

    it.each(['XYZ', 'eur', '', 'USDD'])('rejects non-canonical %s', (currency) => {
      const errors = validate(CreateChargeDto, { ...base, currency });
      expect(errors.map((error) => error.property)).toContain('currency');
    });
  });

  describe('UpdateChargeDto.currency', () => {
    it.each(['USD', 'VES', 'ARS', 'COP'])('accepts canonical %s', (currency) => {
      expect(validate(UpdateChargeDto, { currency })).toHaveLength(0);
    });

    it.each(['XYZ', 'eur'])('rejects non-canonical %s', (currency) => {
      expect(validate(UpdateChargeDto, { currency }).map((error) => error.property)).toContain(
        'currency',
      );
    });
  });

  describe('SubmitPaymentDto.currency', () => {
    const base = {
      amount: 10000,
      method: 'TRANSFER',
    };

    it.each(['USD', 'VES', 'ARS', 'COP'])('accepts canonical %s', (currency) => {
      expect(validate(SubmitPaymentDto, { ...base, currency })).toHaveLength(0);
    });

    it('accepts absent currency (default ARS)', () => {
      expect(validate(SubmitPaymentDto, base)).toHaveLength(0);
    });

    it.each(['XYZ', 'eur', ''])('rejects non-canonical %s', (currency) => {
      const errors = validate(SubmitPaymentDto, { ...base, currency });
      expect(errors.map((error) => error.property)).toContain('currency');
    });
  });
});
