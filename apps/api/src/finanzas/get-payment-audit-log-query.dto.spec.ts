import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { GetPaymentAuditLogQuery } from './tenant-finance.controller';

describe('GetPaymentAuditLogQuery validation', () => {
  it('accepts empty query (optional fields)', async () => {
    const q = plainToInstance(GetPaymentAuditLogQuery, {});
    const errors = await validate(q);
    expect(errors).toHaveLength(0);
  });

  it('accepts valid limit', async () => {
    const q = plainToInstance(GetPaymentAuditLogQuery, { limit: 50 });
    const errors = await validate(q);
    expect(errors).toHaveLength(0);
  });

  it('accepts limit = 1 (minimum)', async () => {
    const q = plainToInstance(GetPaymentAuditLogQuery, { limit: 1 });
    const errors = await validate(q);
    expect(errors).toHaveLength(0);
  });

  it('accepts limit = 200 (maximum)', async () => {
    const q = plainToInstance(GetPaymentAuditLogQuery, { limit: 200 });
    const errors = await validate(q);
    expect(errors).toHaveLength(0);
  });

  it('transforms string limit to number', async () => {
    const q = plainToInstance(GetPaymentAuditLogQuery, { limit: '30' });
    const errors = await validate(q);
    expect(errors).toHaveLength(0);
    expect(q.limit).toBe(30);
  });

  it('rejects limit = 0', async () => {
    const q = plainToInstance(GetPaymentAuditLogQuery, { limit: 0 });
    const errors = await validate(q);
    expect(errors.find((e) => e.property === 'limit')).toBeDefined();
  });

  it('rejects limit > 200', async () => {
    const q = plainToInstance(GetPaymentAuditLogQuery, { limit: 201 });
    const errors = await validate(q);
    expect(errors.find((e) => e.property === 'limit')).toBeDefined();
  });

  it('rejects negative limit', async () => {
    const q = plainToInstance(GetPaymentAuditLogQuery, { limit: -5 });
    const errors = await validate(q);
    expect(errors.find((e) => e.property === 'limit')).toBeDefined();
  });

  it('rejects decimal limit', async () => {
    const q = plainToInstance(GetPaymentAuditLogQuery, { limit: 10.5 });
    const errors = await validate(q);
    expect(errors.find((e) => e.property === 'limit')).toBeDefined();
  });

  it('rejects non-numeric limit', async () => {
    const q = plainToInstance(GetPaymentAuditLogQuery, { limit: 'abc' });
    const errors = await validate(q);
    expect(errors.find((e) => e.property === 'limit')).toBeDefined();
  });
});
