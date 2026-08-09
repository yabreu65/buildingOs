import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    await service.list('tenant-1', { baseCurrency: 'USD', quoteCurrency: 'VES' });
    expect(exchangeRate.findMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1', baseCurrency: 'USD', quoteCurrency: 'VES' }, orderBy: { effectiveAt: 'desc' } });
  });

  it('updates using both id and tenantId without changing the historical pair', async () => {
    exchangeRate.updateMany.mockResolvedValue({ count: 1 });
    exchangeRate.findFirstOrThrow.mockResolvedValue(record);
    await service.update('tenant-1', 'rate-1', { rate: '40.25', effectiveAt: dto.effectiveAt, source: 'Market' });
    expect(exchangeRate.updateMany).toHaveBeenCalledWith({ where: { id: 'rate-1', tenantId: 'tenant-1' }, data: expect.not.objectContaining({ baseCurrency: expect.anything(), quoteCurrency: expect.anything() }) });
  });

  it('does not update a rate from another tenant', async () => {
    exchangeRate.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update('tenant-2', 'rate-1', { rate: '40', effectiveAt: dto.effectiveAt })).rejects.toBeInstanceOf(NotFoundException);
  });
});
