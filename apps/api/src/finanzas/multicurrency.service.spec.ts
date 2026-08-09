import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MulticurrencyService } from './multicurrency.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('MulticurrencyService', () => {
  const tenant = { findUniqueOrThrow: jest.fn(), update: jest.fn() };
  const membership = { findFirst: jest.fn() };
  const exchangeRate = {
    findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findFirstOrThrow: jest.fn(),
  };
  const prisma = { tenant, membership, exchangeRate } as unknown as PrismaService;
  const service = new MulticurrencyService(prisma);
  const dto = { baseCurrency: 'USD' as const, quoteCurrency: 'VES' as const, rate: '36.500000000001', effectiveAt: '2026-08-09T00:00:00.000Z', source: 'Central bank' };
  const record = { id: 'rate-1', tenantId: 'tenant-1', ...dto, rate: new Prisma.Decimal(dto.rate), effectiveAt: new Date(dto.effectiveAt), source: dto.source, createdByMembershipId: 'membership-1', createdAt: new Date(), updatedAt: new Date() };
  const publicResponseFields = ['id', 'baseCurrency', 'quoteCurrency', 'rate', 'effectiveAt', 'source', 'createdAt', 'updatedAt'];

  function prismaKnownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError('Sensitive Prisma details', {
      code,
      clientVersion: '5.22.0',
      meta: { target: ['tenantId', 'baseCurrency', 'quoteCurrency', 'effectiveAt'] },
    });
  }

  function expectPublicExchangeRate(response: object): void {
    expect(Object.keys(response).sort()).toEqual([...publicResponseFields].sort());
    expect(response).not.toHaveProperty('tenantId');
    expect(response).not.toHaveProperty('createdByMembershipId');
  }

  beforeEach(() => jest.clearAllMocks());

  it('gets and updates functional currency in the requested tenant', async () => {
    tenant.findUniqueOrThrow.mockResolvedValue({ functionalCurrency: 'ARS' });
    tenant.update.mockResolvedValue({ functionalCurrency: 'COP' });
    await expect(service.getSettings('tenant-1')).resolves.toEqual({ functionalCurrency: 'ARS' });
    await expect(service.updateSettings('tenant-1', 'COP')).resolves.toEqual({ functionalCurrency: 'COP' });
    expect(tenant.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'tenant-1' } }));
  });

  it('creates a tenant-scoped rate and serializes Decimal as a stable string', async () => {
    membership.findFirst.mockResolvedValue({ id: 'membership-1' });
    exchangeRate.create.mockResolvedValue(record);
    await expect(service.create('tenant-1', 'membership-1', dto)).resolves.toMatchObject({ rate: '36.500000000001' });
    expect(exchangeRate.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-1', rate: expect.any(Prisma.Decimal) }) }));
  });

  it.each([
    ['0.000000000001', '0.000000000001'],
    ['0.50', '0.5'],
    ['36.5', '36.5'],
    ['9999999999999999.123456789012', '9999999999999999.123456789012'],
  ])('serializes %s as canonical fixed point usable unchanged by PATCH', async (storedRate, expectedRate) => {
    exchangeRate.findMany.mockResolvedValue([{ ...record, rate: new Prisma.Decimal(storedRate) }]);

    const [response] = await service.list('tenant-1', {});

    expect(response.rate).toBe(expectedRate);
    expect(response.rate).not.toMatch(/[eE]/);
    exchangeRate.updateMany.mockResolvedValue({ count: 1 });
    exchangeRate.findFirstOrThrow.mockResolvedValue({ ...record, rate: new Prisma.Decimal(response.rate) });
    await service.update('tenant-1', 'rate-1', { rate: response.rate, effectiveAt: dto.effectiveAt });
    expect(exchangeRate.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rate: new Prisma.Decimal(expectedRate) }) }));
  });

  it('maps create P2002 to a sanitized conflict payload', async () => {
    exchangeRate.create.mockRejectedValue(prismaKnownRequestError('P2002'));

    const error = await service.create('tenant-1', undefined, dto).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'EXCHANGE_RATE_ALREADY_EXISTS',
      message: 'An exchange rate already exists for this currency pair and effective date',
    });
    expect(JSON.stringify((error as ConflictException).getResponse())).not.toContain('Sensitive Prisma details');
  });

  it('maps update P2002 to a sanitized conflict payload', async () => {
    exchangeRate.updateMany.mockRejectedValue(prismaKnownRequestError('P2002'));

    const error = await service.update('tenant-1', 'rate-1', { rate: '36.5', effectiveAt: dto.effectiveAt }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'EXCHANGE_RATE_ALREADY_EXISTS',
      message: 'An exchange rate already exists for this currency pair and effective date',
    });
  });

  it.each(['create', 'update'] as const)('rethrows non-P2002 errors from %s unchanged', async (operation) => {
    const error = prismaKnownRequestError('P2024');
    if (operation === 'create') exchangeRate.create.mockRejectedValue(error);
    else exchangeRate.updateMany.mockRejectedValue(error);

    const request = operation === 'create'
      ? service.create('tenant-1', undefined, dto)
      : service.update('tenant-1', 'rate-1', { rate: '36.5', effectiveAt: dto.effectiveAt });

    await expect(request).rejects.toBe(error);
  });

  it('rejects a creator membership from another tenant', async () => {
    membership.findFirst.mockResolvedValue(null);
    await expect(service.create('tenant-1', 'membership-2', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'membership-2', tenantId: 'tenant-1' } }));
  });

  it.each(['0', '-1'])('rejects non-positive rate %s', async (rate) => {
    await expect(service.create('tenant-1', undefined, { ...dto, rate })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an equal currency pair', async () => {
    await expect(service.create('tenant-1', undefined, { ...dto, quoteCurrency: 'USD' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists only tenant rates ordered by effective date descending', async () => {
    exchangeRate.findMany.mockResolvedValue([record]);
    const [response] = await service.list('tenant-1', { baseCurrency: 'USD', quoteCurrency: 'VES' });
    expect(exchangeRate.findMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1', baseCurrency: 'USD', quoteCurrency: 'VES' }, orderBy: { effectiveAt: 'desc' } });
    expectPublicExchangeRate(response);
  });

  it('returns every public field and no internal fields from create', async () => {
    exchangeRate.create.mockResolvedValue(record);
    expectPublicExchangeRate(await service.create('tenant-1', undefined, dto));
  });

  it('updates using both id and tenantId without changing the historical pair', async () => {
    exchangeRate.updateMany.mockResolvedValue({ count: 1 });
    exchangeRate.findFirstOrThrow.mockResolvedValue(record);
    const response = await service.update('tenant-1', 'rate-1', { rate: '40.25', effectiveAt: dto.effectiveAt, source: 'Market' });
    expect(exchangeRate.updateMany).toHaveBeenCalledWith({ where: { id: 'rate-1', tenantId: 'tenant-1' }, data: expect.not.objectContaining({ baseCurrency: expect.anything(), quoteCurrency: expect.anything() }) });
    expectPublicExchangeRate(response);
  });

  it('does not update a rate from another tenant', async () => {
    exchangeRate.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update('tenant-2', 'rate-1', { rate: '40', effectiveAt: dto.effectiveAt })).rejects.toBeInstanceOf(NotFoundException);
  });
});
