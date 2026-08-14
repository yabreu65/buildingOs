import { Injectable } from '@nestjs/common';
import { ChargeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantDebtCalculatorService } from './assistant-debt-calculator.service';
import type { ReportCurrencyAmountBucket } from '../finanzas/currency-buckets';

export interface TenantDebtSummary {
  outstandingByCurrency: ReportCurrencyAmountBucket[];
  chargeCount: number;
}

export async function resolveTenantDebtSummary(
  prisma: PrismaService,
  debtCalculator: AssistantDebtCalculatorService,
  tenantId: string,
): Promise<TenantDebtSummary> {
  const charges = await prisma.charge.findMany({
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
  });

  return {
    outstandingByCurrency: debtCalculator.calculateOutstandingByCurrency(charges),
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
