import { Injectable } from '@nestjs/common';
import { LiquidationsService } from './liquidations.service';

/**
 * Thin facade over LiquidationsService (M1).
 *
 * Keeps the legacy route `/tenants/:tenantId/liquidations` working while
 * guaranteeing that every write operation goes through the exact same
 * invariants as the active engine: tenant/building scoping, membership and
 * role checks, valuation mode determination, mixed-currency guards and
 * publication snapshot reconciliation.
 *
 * No monetary logic lives here; baseCurrency is always resolved by M1 rules
 * (functional currency validation for FUNCTIONAL drafts, single-currency
 * match for LEGACY_NOMINAL drafts).
 */
@Injectable()
export class LiquidationEngineService {
  constructor(private readonly liquidations: LiquidationsService) {}

  async createLiquidationDraft(
    tenantId: string,
    buildingId: string,
    period: string,
    baseCurrency: string,
    membershipId: string,
  ) {
    return this.liquidations.createDraft(tenantId, membershipId, {
      buildingId,
      period,
      baseCurrency,
    });
  }

  async getLiquidationDetail(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
  ) {
    return this.liquidations.getLiquidation(
      tenantId,
      liquidationId,
      membershipId,
    );
  }

  async reviewLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
  ) {
    return this.liquidations.reviewLiquidation(
      tenantId,
      liquidationId,
      membershipId,
    );
  }

  async publishLiquidation(
    tenantId: string,
    liquidationId: string,
    dueDate: Date,
    membershipId: string,
  ) {
    return this.liquidations.publishLiquidation(
      tenantId,
      liquidationId,
      membershipId,
      { dueDate: dueDate.toISOString() },
    );
  }

  async cancelLiquidation(
    tenantId: string,
    liquidationId: string,
    membershipId: string,
  ) {
    return this.liquidations.cancelLiquidation(
      tenantId,
      liquidationId,
      membershipId,
    );
  }
}
