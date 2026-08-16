import {
  LIQUIDATION_INCOME_OFFSET_CURRENCY_MISMATCH,
  LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED,
  LIQUIDATION_INCOME_OFFSETS_EXCEED_GROSS,
  deriveApplicationFunctionalValues,
  distributeMinorByWeights,
  resolveIncomeOffsetBuildingShare,
  valueIncomeOffsetForLiquidation,
  buildIncomeOffsetExceedsGrossError,
} from './income-offset-allocation';

describe('income-offset-allocation (FIN-06)', () => {
  describe('distributeMinorByWeights', () => {
    it('distributes exactly with integer weights (60/40)', () => {
      const result = distributeMinorByWeights(7000, [
        { buildingId: 'a', amountMinor: 6000 },
        { buildingId: 'b', amountMinor: 4000 },
      ]);

      expect(result).toEqual([
        { buildingId: 'a', amountMinor: 4200 },
        { buildingId: 'b', amountMinor: 2800 },
      ]);
    });

    it('preserves exact total with rounding remainders', () => {
      const result = distributeMinorByWeights(10001, [
        { buildingId: 'a', amountMinor: 6000 },
        { buildingId: 'b', amountMinor: 4000 },
      ]);

      const total = result.reduce((sum, item) => sum + item.amountMinor, 0);
      expect(total).toBe(10001);
      expect(result).toEqual([
        { buildingId: 'a', amountMinor: 6001 },
        { buildingId: 'b', amountMinor: 4000 },
      ]);
    });

    it('is deterministic across repeated calls', () => {
      const weights = [
        { buildingId: 'x', amountMinor: 3333 },
        { buildingId: 'y', amountMinor: 3333 },
        { buildingId: 'z', amountMinor: 3334 },
      ];
      const first = distributeMinorByWeights(10001, weights);
      const second = distributeMinorByWeights(10001, weights);

      expect(first).toEqual(second);
      expect(first.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(10001);
    });

    it('tie-breaks by buildingId deterministically', () => {
      const result = distributeMinorByWeights(1, [
        { buildingId: 'b', amountMinor: 1 },
        { buildingId: 'a', amountMinor: 1 },
      ]);

      expect(result).toEqual([
        { buildingId: 'a', amountMinor: 1 },
        { buildingId: 'b', amountMinor: 0 },
      ]);
    });

    it('returns zero shares for zero total', () => {
      const result = distributeMinorByWeights(0, [
        { buildingId: 'a', amountMinor: 100 },
      ]);

      expect(result).toEqual([{ buildingId: 'a', amountMinor: 0 }]);
    });

    it('throws on negative total', () => {
      expect(() =>
        distributeMinorByWeights(-1, [{ buildingId: 'a', amountMinor: 1 }]),
      ).toThrow();
    });
  });

  describe('deriveApplicationFunctionalValues', () => {
    it('allocates functional value proportionally and exactly', () => {
      const result = deriveApplicationFunctionalValues({
        incomeFunctionalAmountMinor: 2500,
        applications: [
          { id: 'offset', amountMinor: 7000 },
          { id: 'fund', amountMinor: 3000 },
        ],
      });

      expect(result).toEqual([
        { applicationId: 'fund', functionalAmountMinor: 750 },
        { applicationId: 'offset', functionalAmountMinor: 1750 },
      ]);
    });

    it('reconciles to income functional total with remainder', () => {
      const result = deriveApplicationFunctionalValues({
        incomeFunctionalAmountMinor: 2501,
        applications: [
          { id: 'offset', amountMinor: 7000 },
          { id: 'fund', amountMinor: 3000 },
        ],
      });

      const total = result.reduce((sum, item) => sum + item.functionalAmountMinor, 0);
      expect(total).toBe(2501);
    });

    it('is deterministic and sorted by application id', () => {
      const applications = [
        { id: 'z', amountMinor: 5000 },
        { id: 'a', amountMinor: 5000 },
      ];
      const first = deriveApplicationFunctionalValues({
        incomeFunctionalAmountMinor: 1000,
        applications,
      });
      const second = deriveApplicationFunctionalValues({
        incomeFunctionalAmountMinor: 1000,
        applications,
      });

      expect(first).toEqual(second);
      expect(first.map((item) => item.applicationId)).toEqual(['a', 'z']);
    });
  });

  describe('resolveIncomeOffsetBuildingShare', () => {
    const base = {
      applicationAmountMinor: 7000,
      liquidationBuildingId: 'building-a',
    };

    it('BUILDING scope: full share when income belongs to the building', () => {
      expect(
        resolveIncomeOffsetBuildingShare({
          ...base,
          applicationScopeType: 'BUILDING' as const,
          incomeBuildingId: 'building-a',
          allocationWeights: [],
        }),
      ).toBe(7000);
    });

    it('BUILDING scope: zero when income belongs to another building', () => {
      expect(
        resolveIncomeOffsetBuildingShare({
          ...base,
          applicationScopeType: 'BUILDING' as const,
          incomeBuildingId: 'building-b',
          allocationWeights: [],
        }),
      ).toBe(0);
    });

    it('TENANT_SHARED: proportional share by persisted allocation weights', () => {
      expect(
        resolveIncomeOffsetBuildingShare({
          ...base,
          applicationScopeType: 'TENANT_SHARED' as const,
          incomeBuildingId: null,
          allocationWeights: [
            { buildingId: 'building-a', amountMinor: 6000 },
            { buildingId: 'building-b', amountMinor: 4000 },
          ],
        }),
      ).toBe(4200);
    });

    it('TENANT_SHARED: zero when the income is not allocated to the building', () => {
      expect(
        resolveIncomeOffsetBuildingShare({
          ...base,
          applicationScopeType: 'TENANT_SHARED' as const,
          incomeBuildingId: null,
          allocationWeights: [
            { buildingId: 'building-c', amountMinor: 6000 },
          ],
        }),
      ).toBe(0);
    });

    it('TENANT_SHARED: zero when no allocations persisted', () => {
      expect(
        resolveIncomeOffsetBuildingShare({
          ...base,
          applicationScopeType: 'TENANT_SHARED' as const,
          incomeBuildingId: null,
          allocationWeights: [],
        }),
      ).toBe(0);
    });

    it('UNIT_GROUP: same proportional behavior as TENANT_SHARED', () => {
      expect(
        resolveIncomeOffsetBuildingShare({
          ...base,
          applicationScopeType: 'UNIT_GROUP' as const,
          incomeBuildingId: null,
          allocationWeights: [
            { buildingId: 'building-a', amountMinor: 1000 },
            { buildingId: 'building-b', amountMinor: 9000 },
          ],
        }),
      ).toBe(700);
    });

    it('keeps shares of all buildings summing to application amount', () => {
      const shares = distributeMinorByWeights(7000, [
        { buildingId: 'building-a', amountMinor: 6000 },
        { buildingId: 'building-b', amountMinor: 4000 },
      ]);
      expect(shares.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(7000);
    });
  });

  describe('valueIncomeOffsetForLiquidation', () => {
    const baseApplication = {
      id: 'app-1',
      amountMinor: 7000,
      currencyCode: 'ARS',
      functionalAmountMinor: null,
      functionalCurrencyCode: null,
    };

    it('LEGACY_NOMINAL: same currency accepted', () => {
      expect(
        valueIncomeOffsetForLiquidation({
          application: baseApplication,
          valuationMode: 'LEGACY_NOMINAL' as const,
          baseCurrency: 'ARS',
        }),
      ).toBe(7000);
    });

    it('LEGACY_NOMINAL: other currency rejected with mismatch error', () => {
      const action = () =>
        valueIncomeOffsetForLiquidation({
          application: { ...baseApplication, currencyCode: 'USD' },
          valuationMode: 'LEGACY_NOMINAL' as const,
          baseCurrency: 'ARS',
        });

      expect(action).toThrow();
      try {
        action();
      } catch (error) {
        expect((error as { getResponse(): { error: string } }).getResponse().error).toBe(
          LIQUIDATION_INCOME_OFFSET_CURRENCY_MISMATCH,
        );
      }
    });

    it('FUNCTIONAL: uses frozen functional snapshot', () => {
      expect(
        valueIncomeOffsetForLiquidation({
          application: {
            ...baseApplication,
            functionalAmountMinor: 1750,
            functionalCurrencyCode: 'ARS',
          },
          valuationMode: 'FUNCTIONAL' as const,
          baseCurrency: 'ARS',
        }),
      ).toBe(1750);
    });

    it('FUNCTIONAL: missing snapshot rejected', () => {
      const action = () =>
        valueIncomeOffsetForLiquidation({
          application: baseApplication,
          valuationMode: 'FUNCTIONAL' as const,
          baseCurrency: 'ARS',
        });

      expect(action).toThrow();
      try {
        action();
      } catch (error) {
        expect((error as { getResponse(): { error: string } }).getResponse().error).toBe(
          LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED,
        );
      }
    });

    it('FUNCTIONAL: functional currency mismatch rejected', () => {
      const action = () =>
        valueIncomeOffsetForLiquidation({
          application: {
            ...baseApplication,
            functionalAmountMinor: 1750,
            functionalCurrencyCode: 'USD',
          },
          valuationMode: 'FUNCTIONAL' as const,
          baseCurrency: 'ARS',
        });

      expect(action).toThrow();
      try {
        action();
      } catch (error) {
        expect((error as { getResponse(): { error: string } }).getResponse().error).toBe(
          LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED,
        );
      }
    });
  });

  describe('error builders', () => {
    it('builds exceeds-gross error', () => {
      const error = buildIncomeOffsetExceedsGrossError({
        incomeOffsetAmountMinor: 12000,
        preIncomeAmountMinor: 10000,
      });

      expect(error.getStatus()).toBe(422);
      expect((error.getResponse() as { error: string }).error).toBe(
        LIQUIDATION_INCOME_OFFSETS_EXCEED_GROSS,
      );
    });

    it('exports the expected error codes', () => {
      expect(LIQUIDATION_INCOME_OFFSET_CURRENCY_MISMATCH).toBe(
        'LIQUIDATION_INCOME_OFFSET_CURRENCY_MISMATCH',
      );
      expect(LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED).toBe(
        'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
      );
    });
  });
});
