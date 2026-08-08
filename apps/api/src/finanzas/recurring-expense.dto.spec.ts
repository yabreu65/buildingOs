import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
  RecurringExpenseAllocationInputDto,
} from './recurring-expense.dto';

describe('RecurringExpenseAllocationInputDto', () => {
  describe('valid payloads', () => {
    it('accepts buildingId with percentage', async () => {
      const dto = plainToInstance(RecurringExpenseAllocationInputDto, {
        buildingId: 'bld-1',
        percentage: 50,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects allocation with amountMinor only (percentage is required)', async () => {
      const dto = plainToInstance(RecurringExpenseAllocationInputDto, {
        buildingId: 'bld-1',
        amountMinor: 5000,
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'percentage')).toBeDefined();
    });

    it('rejects missing percentage', async () => {
      const dto = plainToInstance(RecurringExpenseAllocationInputDto, {
        buildingId: 'bld-1',
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'percentage')).toBeDefined();
    });
  });

  describe('invalid payloads', () => {
    it('rejects missing buildingId', async () => {
      const dto = plainToInstance(RecurringExpenseAllocationInputDto, {
        percentage: 50,
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'buildingId')).toBeDefined();
    });

    it('rejects empty buildingId', async () => {
      const dto = plainToInstance(RecurringExpenseAllocationInputDto, {
        buildingId: '',
        percentage: 50,
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'buildingId')).toBeDefined();
    });

    it('rejects negative percentage', async () => {
      const dto = plainToInstance(RecurringExpenseAllocationInputDto, {
        buildingId: 'bld-1',
        percentage: -10,
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'percentage')).toBeDefined();
    });

    it('rejects decimal percentage (must be integer)', async () => {
      const dto = plainToInstance(RecurringExpenseAllocationInputDto, {
        buildingId: 'bld-1',
        percentage: 50.5,
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'percentage')).toBeDefined();
    });

    it('rejects non-numeric percentage', async () => {
      const dto = plainToInstance(RecurringExpenseAllocationInputDto, {
        buildingId: 'bld-1',
        percentage: 'abc',
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'percentage')).toBeDefined();
    });

    it('rejects percentage above 100', async () => {
      const dto = plainToInstance(RecurringExpenseAllocationInputDto, {
        buildingId: 'bld-1',
        percentage: 150,
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'percentage')).toBeDefined();
    });
  });
});

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

    it('accepts BUILDING scopeType', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        scopeType: 'BUILDING',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts TENANT_SHARED scopeType with allocations', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        scopeType: 'TENANT_SHARED',
        allocationMode: 'EQUAL_SHARE',
        allocations: [
          { buildingId: 'bld-1', percentage: 50 },
          { buildingId: 'bld-2', percentage: 50 },
        ],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts allocationMode EQUAL_SHARE', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        scopeType: 'TENANT_SHARED',
        allocationMode: 'EQUAL_SHARE',
        allocations: [{ buildingId: 'bld-1', percentage: 100 }],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts allocationMode BUILDING_TOTAL_M2', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        scopeType: 'TENANT_SHARED',
        allocationMode: 'BUILDING_TOTAL_M2',
        allocations: [{ buildingId: 'bld-1', percentage: 100 }],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts allocationMode MANUAL with percentage allocations', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        scopeType: 'TENANT_SHARED',
        allocationMode: 'MANUAL',
        allocations: [
          { buildingId: 'bld-1', percentage: 50 },
          { buildingId: 'bld-2', percentage: 50 },
        ],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts optional scopeType (defaults to BUILDING at service level)', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, validPayload);
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

    it('rejects decimal amount (must be integer cents)', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        amount: 10.5,
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

    it('rejects invalid scopeType', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        scopeType: 'UNIT_GROUP',
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'scopeType')).toBeDefined();
    });

    it('rejects invalid allocationMode', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        scopeType: 'TENANT_SHARED',
        allocationMode: 'INVALID',
        allocations: [{ buildingId: 'bld-1', percentage: 100 }],
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'allocationMode')).toBeDefined();
    });

    it('rejects empty allocations array', async () => {
      const dto = plainToInstance(CreateRecurringExpenseDto, {
        ...validPayload,
        scopeType: 'TENANT_SHARED',
        allocationMode: 'EQUAL_SHARE',
        allocations: [],
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'allocations')).toBeDefined();
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

    it('accepts updating allocationMode', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, {
        allocationMode: 'BUILDING_TOTAL_M2',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts updating allocations', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, {
        allocations: [
          { buildingId: 'bld-1', percentage: 60 },
          { buildingId: 'bld-2', percentage: 40 },
        ],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts updating both allocationMode and allocations', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, {
        allocationMode: 'MANUAL',
        allocations: [
          { buildingId: 'bld-1', percentage: 60 },
          { buildingId: 'bld-2', percentage: 40 },
        ],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('invalid payloads', () => {
    it('rejects 0 as isActive', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { isActive: 0 });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'isActive')).toBeDefined();
    });

    it('rejects 1 as isActive', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { isActive: 1 });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'isActive')).toBeDefined();
    });

    it('rejects "true" as isActive', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { isActive: 'true' });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'isActive')).toBeDefined();
    });

    it('rejects "false" as isActive', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { isActive: 'false' });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'isActive')).toBeDefined();
    });

    it('rejects "yes" as isActive', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { isActive: 'yes' });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'isActive')).toBeDefined();
    });

    it('rejects object as isActive', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { isActive: { a: 1 } });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'isActive')).toBeDefined();
    });

    it('rejects array as isActive', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { isActive: [1] });
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

    it('rejects decimal amount (must be integer cents)', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { amount: 10.5 });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'amount')).toBeDefined();
    });

    it('rejects empty concept', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, { concept: '' });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'concept')).toBeDefined();
    });

    it('rejects invalid allocationMode', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, {
        allocationMode: 'INVALID',
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'allocationMode')).toBeDefined();
    });

    it('rejects empty allocations array', async () => {
      const dto = plainToInstance(UpdateRecurringExpenseDto, {
        allocations: [],
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'allocations')).toBeDefined();
    });
  });
});
