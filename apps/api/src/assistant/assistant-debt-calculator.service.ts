import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { calculateChargeOutstandingMinor } from '../finanzas/charge-aggregation';
import {
  aggregateReportBuckets,
  type ReportCurrencyAmountBucket,
} from '../finanzas/currency-buckets';

export interface AssistantDebtAllocation {
  readonly amount: number;
  readonly payment?: { readonly status: PaymentStatus | string } | null;
}

export interface AssistantDebtCharge {
  readonly amount: number;
  readonly currency?: string | null;
  readonly unitId?: string | null;
  readonly paymentAllocations: readonly AssistantDebtAllocation[];
}

@Injectable()
export class AssistantDebtCalculatorService {
  /**
   * Calculate outstanding debt for a single charge (Charge.currency, minor units).
   * Delegates to the canonical Phase 3F charge-aggregation helper.
   */
  calculateChargeOutstanding(charge: AssistantDebtCharge): number {
    return calculateChargeOutstandingMinor(charge);
  }

  /**
   * Aggregate outstanding debt for many charges into explicit currency
   * buckets (canonical first, legacy after). Never sums across currencies.
   */
  calculateOutstandingByCurrency(
    charges: AssistantDebtCharge[],
  ): ReportCurrencyAmountBucket[] {
    return aggregateReportBuckets(
      charges
        .filter((charge) => charge.currency)
        .map((charge) => ({
          currency: charge.currency as string,
          amountMinor: this.calculateChargeOutstanding(charge),
        })),
    );
  }

  /**
   * Aggregate outstanding debt per unit into explicit currency buckets.
   * Each unit exposes one bucket per currency — no mixed scalar.
   */
  calculateOutstandingByUnit(
    charges: AssistantDebtCharge[],
  ): Map<string, ReportCurrencyAmountBucket[]> {
    const entriesByUnit = new Map<string, Array<{ currency: string; amountMinor: number }>>();

    for (const charge of charges) {
      if (!charge.unitId || !charge.currency) {
        continue;
      }

      const debt = this.calculateChargeOutstanding(charge);
      if (debt <= 0) {
        continue;
      }

      const entries = entriesByUnit.get(charge.unitId) ?? [];
      entries.push({ currency: charge.currency, amountMinor: debt });
      entriesByUnit.set(charge.unitId, entries);
    }

    const result = new Map<string, ReportCurrencyAmountBucket[]>();
    for (const [unitId, entries] of entriesByUnit) {
      result.set(unitId, aggregateReportBuckets(entries));
    }
    return result;
  }
}
