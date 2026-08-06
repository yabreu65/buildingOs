import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
} from './recurring-expense.dto';

describe('CreateRecurringExpenseDto', () => {
  const validPayload = {
    categoryId: 'cat-1',
    amount: 5000,
    currency: 'ARS',
    concept: 'Expensas mensuales',
    frequency: 'MONTHLY',
  };

  describe('valid payloads', () => {
    it('accepts a complete valid payload', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, validPayload);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts QUARTERLY frequency', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        frequency: 'QUARTERLY',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts YEARLY frequency', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        frequency: 'YEARLY',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts USD currency', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        currency: 'USD',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts VES currency', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        currency: 'VES',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('invalid payloads', () => {
    it('rejects missing categoryId', async () => {
      const { categoryId, ...rest } = validPayload;
      const dto = plainToInstance(CreateRecurringExpenseDto, rest);
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'categoryId')).toBeDefined();
    });

    it('rejects empty categoryId', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        categoryId: '',
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'categoryId')).toBeDefined();
    });

    it('rejects missing amount', async () => {
      const { amount, ...rest } = validPayload;
      const dto = plainToInstance(CreateRecurringExpenseDto, rest);
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'amount')).toBeDefined();
    });

    it('rejects zero amount', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        amount: 0,
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'amount')).toBeDefined();
    });

    it('rejects negative amount', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        amount: -100,
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'amount')).toBeDefined();
    });

    it('rejects non-numeric amount', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        amount: 'abc',
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'amount')).toBeDefined();
    });

    it('rejects missing currency', async () => {
      const { currency, ...rest } = validPayload;
      const dto = plainToInstance(CreateRecurringExpenseDto, rest);
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'currency')).toBeDefined();
    });

    it('rejects invalid currency', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        currency: 'EUR',
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'currency')).toBeDefined();
    });

    it('rejects missing concept', async () => {
      const { concept, ...rest } = validPayload;
      const dto = plainToInstance(CreateRecurringExpenseDto, rest);
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'concept')).toBeDefined();
    });

    it('rejects empty concept', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        concept: '',
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'concept')).toBeDefined();
    });

    it('rejects missing frequency', async () => {
      const { frequency, ...rest } = validPayload;
      const dto = plainToInstance(CreateRecurringExpenseDto, rest);
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'frequency')).toBeDefined();
    });

    it('rejects invalid frequency', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        frequency: 'WEEKLY',
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'frequency')).toBeDefined();
    });
  });
});

describe('UpdateRecurringExpenseDto', () => {
  describe('valid payloads', () => {
    it('accepts updating only isActive', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, {
        isActive: false,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts updating only amount', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { amount: 7500 });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts updating only concept', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, {
        concept: 'New concept',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts combining multiple optional fields', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, {
        isActive: true,
        amount: 10000,
        concept: 'Updated concept',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts empty payload (no changes)', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, {});
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('invalid payloads', () => {
    it('rejects non-boolean isActive', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, {
        isActive: 'yes',
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'isActive')).toBeDefined();
    });

    it('rejects zero amount', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { amount: 0 });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'amount')).toBeDefined();
    });

    it('rejects negative amount', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { amount: -50 });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'amount')).toBeDefined();
    });

    it('rejects non-numeric amount', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, {
        amount: 'invalid',
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'amount')).toBeDefined();
    });

    it('rejects empty concept', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { concept: '' });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'concept')).toBeDefined();
    });
  });
});
