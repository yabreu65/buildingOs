import { Injectable } from '@nestjs/common';
import { ChargeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantDebtCalculatorService } from './assistant-debt-calculator.service';

export interface TenantDebtSummary {
  totalDebt: number;
  currency: string;
  chargeCount: number;
}

export async function resolveTenantDebtSummary(
  prisma: PrismaService,
  debtCalculator: AssistantDebtCalculatorService,
  tenantId: string,
): Promise<TenantDebtSummary> {
  const [tenant, charges] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { currency: true },
    }),
    prisma.charge.findMany({
      where: {
        tenantId,
        status: { in: [ChargeStatus.PENDING, ChargeStatus.PARTIAL] },
        canceledAt: null,
      },
      include: {
        paymentAllocations: {
          include: {
            payment: {
              select: {
                status: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    totalDebt: debtCalculator.calculateOutstanding(charges),
    currency: tenant.currency,
    chargeCount: charges.length,
  };
}

@Injectable()
export class AssistantTenantDebtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly debtCalculator: AssistantDebtCalculatorService,
  ) {}

  async resolveTenantDebtSummary(tenantId: string): Promise<TenantDebtSummary> {
    return resolveTenantDebtSummary(this.prisma, this.debtCalculator, tenantId);
  }
}
