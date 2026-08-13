import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { calculateChargeOutstandingMinor } from '../finanzas/charge-aggregation';

export interface AssistantDebtAllocation {
  readonly amount: number;
  readonly payment?: { readonly status: PaymentStatus | string } | null;
}

export interface AssistantDebtCharge {
  readonly amount: number;
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
   * Calculate total outstanding debt for many charges.
   */
  calculateOutstanding(charges: AssistantDebtCharge[]): number {
    return charges.reduce((sum, charge) => sum + this.calculateChargeOutstanding(charge), 0);
  }

  /**
   * Calculate outstanding debt grouped by unitId.
   */
  calculateOutstandingByUnit(charges: AssistantDebtCharge[]): Map<string, number> {
    const debtByUnit = new Map<string, number>();

    for (const charge of charges) {
      if (!charge.unitId) {
        continue;
      }

      const debt = this.calculateChargeOutstanding(charge);
      debtByUnit.set(charge.unitId, (debtByUnit.get(charge.unitId) ?? 0) + debt);
    }

    return debtByUnit;
  }
}
