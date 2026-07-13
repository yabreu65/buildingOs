import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ExpenseLedgerCategoryParamDto,
  ExpenseLedgerCategoryQueryDto,
} from './expense-ledger.dto';

describe('ExpenseLedgerCategoryQueryDto', () => {
  const validate = (input: Record<string, unknown>) =>
    validateSync(plainToInstance(ExpenseLedgerCategoryQueryDto, input), {
      whitelist: true,
      forbidUnknownValues: true,
    });

  it('accepts a valid movementType', () => {
    expect(validate({ movementType: 'EXPENSE' })).toHaveLength(0);
  });

  it('rejects an invalid movementType', () => {
    const errors = validate({ movementType: 'OTHER' });

    expect(errors.map((error) => error.property)).toContain('movementType');
  });

  it('accepts a valid catalogScope', () => {
    expect(validate({ catalogScope: 'BUILDING' })).toHaveLength(0);
  });

  it('rejects an invalid catalogScope', () => {
    const errors = validate({ catalogScope: 'ANYWHERE' });

    expect(errors.map((error) => error.property)).toContain('catalogScope');
  });

  it('accepts both filters together when valid', () => {
    expect(
      validate({ movementType: 'INCOME', catalogScope: 'CONDOMINIUM_COMMON' }),
    ).toHaveLength(0);
  });

  it('accepts both filters omitted', () => {
    expect(validate({})).toHaveLength(0);
  });

  it('rejects arbitrary strings before they reach the service', () => {
    const errors = validate({
      movementType: 'foo',
      catalogScope: 'bar',
      extra: 'baz',
    });

    expect(errors.map((error) => error.property).sort()).toEqual(['catalogScope', 'movementType']);
  });

  it('accepts a valid categoryId', () => {
    expect(
      validateSync(
        plainToInstance(ExpenseLedgerCategoryParamDto, {
          categoryId: 'c123456789012345678901234',
        }),
        {
          whitelist: true,
          forbidUnknownValues: true,
        },
      ),
    ).toHaveLength(0);
  });

  it('rejects an invalid categoryId', () => {
    const errors = validateSync(
      plainToInstance(ExpenseLedgerCategoryParamDto, {
        categoryId: 'cat-1',
      }),
      {
        whitelist: true,
        forbidUnknownValues: true,
      },
    );

    expect(errors.map((error) => error.property)).toContain('categoryId');
  });
});
