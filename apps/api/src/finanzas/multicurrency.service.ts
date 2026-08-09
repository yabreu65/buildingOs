import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CanonicalCurrency } from '@buildingos/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExchangeRateDto, ExchangeRateQueryDto, UpdateExchangeRateDto } from './multicurrency.dto';

export interface ExchangeRateResponse {
  readonly id: string;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rate: string;
  readonly effectiveAt: Date;
  readonly source: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

@Injectable()
export class MulticurrencyService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(tenantId: string): Promise<{ functionalCurrency: string }> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { functionalCurrency: true } });
    return tenant;
  }

  async updateSettings(tenantId: string, functionalCurrency: CanonicalCurrency): Promise<{ functionalCurrency: string }> {
    return this.prisma.tenant.update({ where: { id: tenantId }, data: { functionalCurrency }, select: { functionalCurrency: true } });
  }

  async list(tenantId: string, query: ExchangeRateQueryDto): Promise<ExchangeRateResponse[]> {
    const rates = await this.prisma.exchangeRate.findMany({
      where: { tenantId, baseCurrency: query.baseCurrency, quoteCurrency: query.quoteCurrency },
      orderBy: { effectiveAt: 'desc' },
    });
    return rates.map((rate) => this.serialize(rate));
  }

  async create(tenantId: string, membershipId: string | undefined, dto: CreateExchangeRateDto): Promise<ExchangeRateResponse> {
    this.assertPair(dto);
    this.assertRate(dto.rate);
    if (membershipId) {
      const membership = await this.prisma.membership.findFirst({ where: { id: membershipId, tenantId }, select: { id: true } });
      if (!membership) throw new BadRequestException('Creator membership does not belong to tenant');
    }
    const rate = await this.prisma.exchangeRate.create({ data: { tenantId, ...dto, rate: new Prisma.Decimal(dto.rate), effectiveAt: new Date(dto.effectiveAt), source: dto.source?.trim() || null, createdByMembershipId: membershipId || null } });
    return this.serialize(rate);
  }

  async update(tenantId: string, id: string, dto: UpdateExchangeRateDto): Promise<ExchangeRateResponse> {
    this.assertRate(dto.rate);
    const result = await this.prisma.exchangeRate.updateMany({ where: { id, tenantId }, data: { ...dto, rate: new Prisma.Decimal(dto.rate), effectiveAt: new Date(dto.effectiveAt), source: dto.source?.trim() || null } });
    if (result.count !== 1) throw new NotFoundException('Exchange rate not found');
    const rate = await this.prisma.exchangeRate.findFirstOrThrow({ where: { id, tenantId } });
    return this.serialize(rate);
  }

  private assertPair(dto: CreateExchangeRateDto): void {
    if (dto.baseCurrency === dto.quoteCurrency) throw new BadRequestException('Base and quote currencies must differ');
  }

  private assertRate(rate: string): void {
    if (!new Prisma.Decimal(rate).greaterThan(0)) throw new BadRequestException('Rate must be greater than zero');
  }

  private serialize(rate: { id: string; baseCurrency: string; quoteCurrency: string; rate: Prisma.Decimal; effectiveAt: Date; source: string | null; createdAt: Date; updatedAt: Date }): ExchangeRateResponse {
    return { ...rate, rate: rate.rate.toString() };
  }
}
