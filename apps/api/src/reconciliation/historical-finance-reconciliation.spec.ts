import {
  reconcileCharge,
  reconcileCurrencyBuckets,
  reconcileFundTransaction,
  reconcileIncome,
  reconcileLiquidation,
  reconcileLiquidationIncomeOffset,
  reconcileAdjustment,
  reconcileDebtAggregate,
  reconcileMovementAllocations,
  reconcileExpenseLiquidation,
  type HistoricalChargeEvidence,
} from './historical-finance-reconciliation';

describe('historical financial reconciliation', () => {
  const charge = (overrides: Partial<HistoricalChargeEvidence> = {}): HistoricalChargeEvidence => ({
    id: 'charge-1',
    tenantId: 'tenant-1',
    buildingId: 'building-1',
    unitId: 'unit-1',
    amountMinor: 10_000,
    currency: 'ARS',
    paymentAllocations: [],
    ...overrides,
  });

  it.each([
    ['unpaid', 10_000, []],
    ['partial', 6_000, [{ amount: 4_000, payment: { status: 'APPROVED', canceledAt: null } }]],
    ['full', 0, [{ amount: 10_000, payment: { status: 'RECONCILED', canceledAt: null } }]],
    ['canceled allocation', 10_000, [{ amount: 10_000, payment: { status: 'APPROVED', canceledAt: new Date() } }]],
  ] as const)('reconciles %s charge with canonical payment effect', (_name, outstanding, paymentAllocations) => {
    const result = reconcileCharge(charge({ paymentAllocations }));
    expect(result.outcome).toBe('RECONCILED');
    expect(result.evidence?.outstandingMinor).toBe(outstanding);
  });

  it('detects raw over-allocation before the canonical clamp', () => {
    const result = reconcileCharge(charge({
      paymentAllocations: [{ amount: 12_000, payment: { status: 'APPROVED', canceledAt: null } }],
    }));
    expect(result.outcome).toBe('INVALID_BLOCKING');
    expect(result.evidence).toMatchObject({ effectiveAllocatedMinor: 12_000, outstandingMinor: 0 });
    expect(result.findings.map((finding) => finding.code)).toContain('EFFECTIVE_ALLOCATIONS_EXCEED_CHARGE');
  });

  it('reconciles the exact allocation boundary', () => {
    const result = reconcileCharge(charge({
      paymentAllocations: [{ amount: 10_000, payment: { status: 'RECONCILED', canceledAt: null } }],
    }));
    expect(result.outcome).toBe('RECONCILED');
    expect(result.evidence).toEqual({ effectiveAllocatedMinor: 10_000, outstandingMinor: 0 });
  });

  it('does not count a canceled over-allocation as effective', () => {
    const result = reconcileCharge(charge({
      paymentAllocations: [{ amount: 12_000, payment: { status: 'APPROVED', canceledAt: new Date('2026-01-01') } }],
    }));
    expect(result.outcome).toBe('RECONCILED');
    expect(result.evidence).toEqual({ effectiveAllocatedMinor: 0, outstandingMinor: 10_000 });
  });

  it('accepts supported historical cross-currency allocation with frozen charge value', () => {
    const result = reconcileCharge(charge({
      amountMinor: 20_000,
      currency: 'ARS',
      paymentAllocations: [{ amount: 18_250, payment: {
        currency: 'USD',
        functionalCurrency: 'ARS',
        functionalAmountMinor: 18_250,
        status: 'APPROVED',
        canceledAt: null,
      } }],
    }));
    expect(result.outcome).toBe('RECONCILED');
    expect(result.evidence?.effectiveAllocatedMinor).toBe(18_250);
  });

  it('blocks cross-currency allocation without frozen conversion evidence', () => {
    const result = reconcileCharge(charge({
      amountMinor: 20_000,
      currency: 'ARS',
      paymentAllocations: [{ amount: 18_250, payment: {
        currency: 'USD',
        status: 'APPROVED',
        canceledAt: null,
      } }],
    }));
    expect(result.outcome).toBe('INVALID_BLOCKING');
    expect(result.findings.map((finding) => finding.code)).toContain('INVALID_CURRENCY_RELATIONSHIP');
  });

  it('keeps valid historical currencies in independent buckets', () => {
    expect(reconcileCurrencyBuckets([
      { currency: 'ARS', amountMinor: 100 },
      { currency: 'UYU', amountMinor: 200 },
      { currency: 'ARS', amountMinor: 50 },
    ])).toEqual({
      outcome: 'LEGACY_RECONCILED',
      evidence: {
        buckets: [
          { currency: 'ARS', amountMinor: 150 },
          { currency: 'UYU', amountMinor: 200 },
        ],
      },
      findings: [],
    });
  });

  it('never combines different currency buckets', () => {
    const result = reconcileCurrencyBuckets([
      { currency: 'USD', amountMinor: 100 },
      { currency: 'UYU', amountMinor: 100 },
    ]);
    expect(result.evidence?.buckets).toEqual([
      { currency: 'USD', amountMinor: 100 },
      { currency: 'UYU', amountMinor: 100 },
    ]);
    expect(result.evidence?.buckets).not.toEqual([{ currency: 'USD', amountMinor: 200 }]);
  });

  it('reconciles unit and building debt aggregates by currency', () => {
    const evidence = {
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      charges: [charge({ amountMinor: 100, currency: 'ARS' }), charge({ id: 'charge-2', amountMinor: 200, currency: 'UYU' })],
      reportedOutstanding: [
        { currency: 'ARS', amountMinor: 100 },
        { currency: 'UYU', amountMinor: 200 },
      ],
    };
    const buildingResult = reconcileDebtAggregate(evidence);
    const unitResult = reconcileDebtAggregate({ ...evidence, unitId: 'unit-1' });
    for (const result of [buildingResult, unitResult]) {
      expect(result.outcome).toBe('LEGACY_RECONCILED');
      expect(result.evidence?.canonicalOutstanding).toEqual([
        { currency: 'ARS', amountMinor: 100 },
        { currency: 'UYU', amountMinor: 200 },
      ]);
    }
  });

  it('reports deterministic debt aggregate repair evidence', () => {
    const result = reconcileDebtAggregate({
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      charges: [charge({ amountMinor: 100 })],
      reportedOutstanding: [{ currency: 'ARS', amountMinor: 90 }],
    });
    expect(result.outcome).toBe('REPAIRABLE_DISCREPANCY');
    expect(result.evidence).toMatchObject({
      canonicalOutstanding: [{ currency: 'ARS', amountMinor: 100 }],
      reportedOutstanding: [{ currency: 'ARS', amountMinor: 90 }],
    });
  });

  it('rejects cross-tenant charge evidence', () => {
    const result = reconcileCharge(charge({
      paymentAllocations: [{ amount: 1_000, payment: { status: 'APPROVED', canceledAt: null, tenantId: 'tenant-2' } }],
    }));
    expect(result.outcome).toBe('INVALID_BLOCKING');
    expect(result.findings.map((finding) => finding.code)).toContain('CROSS_TENANT_EVIDENCE');
  });

  it('rejects cross-building charge evidence', () => {
    const result = reconcileCharge(charge({
      paymentAllocations: [{ amount: 1_000, payment: { status: 'APPROVED', canceledAt: null, buildingId: 'building-2' } }],
    }));
    expect(result.outcome).toBe('INVALID_BLOCKING');
    expect(result.findings.map((finding) => finding.code)).toContain('CROSS_BUILDING_EVIDENCE');
  });

  it('rejects cross-unit charge evidence', () => {
    const result = reconcileCharge(charge({
      paymentAllocations: [{ amount: 1_000, payment: { status: 'APPROVED', canceledAt: null, unitId: 'unit-2' } }],
    }));
    expect(result.outcome).toBe('INVALID_BLOCKING');
    expect(result.findings.map((finding) => finding.code)).toContain('CROSS_UNIT_EVIDENCE');
  });

  it.each([
    ['V1', { representation: 'V1', totalAmountMinor: 100, persistedTotalMinor: 100, expenseSnapshotTotalMinor: 100, generatedChargesTotalMinor: 100 }, 'LEGACY_RECONCILED'],
    ['V2', { representation: 'V2', totalAmountMinor: 100, persistedTotalMinor: 100, valuedAmountMinor: 100, functionalCurrency: 'ARS', frozenValuation: { originalAmountMinor: 100, valuedAmountMinor: 100, functionalCurrency: 'ARS' } }, 'LEGACY_RECONCILED'],
    ['V3', { representation: 'V3', grossExpenseMinor: 100, adjustmentMinor: 20, offsetMinor: 30, totalAmountMinor: 90, persistedTotalMinor: 90 }, 'RECONCILED'],
    ['ZERO_NET', { representation: 'ZERO_NET', grossExpenseMinor: 100, adjustmentMinor: 0, offsetMinor: 100, totalAmountMinor: 0, persistedTotalMinor: 0 }, 'RECONCILED'],
  ] as const)('reconciles liquidation %s using persisted evidence', (_name, evidence, outcome) => {
    expect(reconcileLiquidation(evidence).outcome).toBe(outcome);
  });

  it('does not reconstruct a mismatched immutable liquidation total', () => {
    const result = reconcileLiquidation({
      representation: 'V3',
      grossExpenseMinor: 100,
      adjustmentMinor: 0,
      offsetMinor: 0,
      totalAmountMinor: 100,
      persistedTotalMinor: 90,
    });
    expect(result.outcome).toBe('INVALID_BLOCKING');
  });

  it('reconciles persisted movement allocation totals exactly', () => {
    expect(reconcileMovementAllocations([
      { tenantId: 'tenant-1', buildingId: 'building-1', currency: 'UYU', amountMinor: 300, percentage: null, parent: { tenantId: 'tenant-1', buildingId: 'building-1', amountMinor: 500, currency: 'UYU' } },
      { tenantId: 'tenant-1', buildingId: 'building-1', currency: 'UYU', amountMinor: 200, percentage: null, parent: { tenantId: 'tenant-1', buildingId: 'building-1', amountMinor: 500, currency: 'UYU' } },
    ]).outcome).toBe('LEGACY_RECONCILED');
  });

  it('reports deterministic allocation repair evidence', () => {
    const result = reconcileMovementAllocations([
      { tenantId: 'tenant-1', buildingId: 'building-1', currency: 'ARS', amountMinor: 90, percentage: null, parent: { tenantId: 'tenant-1', buildingId: 'building-1', amountMinor: 100, currency: 'ARS' } },
    ]);
    expect(result.outcome).toBe('REPAIRABLE_DISCREPANCY');
    expect(result.evidence).toMatchObject({ amountTotal: 90, expectedAmountMinor: 100 });
  });

  it.each([
    [25, 250_000],
    [25.5, 255_000],
    [33.3333, 333_333],
  ])('parses %s%% into exact percentage ten-thousandths', (percentage, expected) => {
    const result = reconcileMovementAllocations([
      { tenantId: 'tenant-1', buildingId: 'building-1', currency: 'ARS', amountMinor: null, percentage, parent: { tenantId: 'tenant-1', buildingId: 'building-1', amountMinor: 300, currency: 'ARS' } },
    ]);
    expect(result.outcome).toBe('REPAIRABLE_DISCREPANCY');
    expect(result.evidence).toMatchObject({ percentageTenThousandthsTotal: expected });
  });

  it('reconciles four exact 25% allocations to 100%', () => {
    const result = reconcileMovementAllocations(
      Array.from({ length: 4 }, () => ({
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        currency: 'ARS',
        amountMinor: null,
        percentage: 25,
        parent: { tenantId: 'tenant-1', buildingId: 'building-1', amountMinor: 300, currency: 'ARS' },
      })),
    );
    expect(result.outcome).toBe('RECONCILED');
    expect(result.evidence).toMatchObject({
      percentageTenThousandthsTotal: 1_000_000,
      expectedPercentageTenThousandths: 1_000_000,
    });
  });

  it('reconciles 33.3333% + 33.3333% + 33.3334% to 100%', () => {
    const result = reconcileMovementAllocations([
      { tenantId: 'tenant-1', buildingId: 'building-1', currency: 'ARS', amountMinor: null, percentage: 33.3333, parent: { tenantId: 'tenant-1', buildingId: 'building-1', amountMinor: 300, currency: 'ARS' } },
      { tenantId: 'tenant-1', buildingId: 'building-1', currency: 'ARS', amountMinor: null, percentage: 33.3333, parent: { tenantId: 'tenant-1', buildingId: 'building-1', amountMinor: 300, currency: 'ARS' } },
      { tenantId: 'tenant-1', buildingId: 'building-1', currency: 'ARS', amountMinor: null, percentage: 33.3334, parent: { tenantId: 'tenant-1', buildingId: 'building-1', amountMinor: 300, currency: 'ARS' } },
    ]);
    expect(result.outcome).toBe('RECONCILED');
    expect(result.evidence).toMatchObject({ percentageTenThousandthsTotal: 1_000_000 });
  });

  it('keeps a true percentage mismatch repairable', () => {
    const result = reconcileMovementAllocations([
      { tenantId: 'tenant-1', buildingId: 'building-1', currency: 'ARS', amountMinor: null, percentage: 25, parent: { tenantId: 'tenant-1', buildingId: 'building-1', amountMinor: 300, currency: 'ARS' } },
      { tenantId: 'tenant-1', buildingId: 'building-1', currency: 'ARS', amountMinor: null, percentage: 25, parent: { tenantId: 'tenant-1', buildingId: 'building-1', amountMinor: 300, currency: 'ARS' } },
    ]);
    expect(result.outcome).toBe('REPAIRABLE_DISCREPANCY');
    expect(result.evidence).toMatchObject({
      percentageTenThousandthsTotal: 500_000,
      expectedPercentageTenThousandths: 1_000_000,
    });
  });

  it('allows a legitimate unapplied income remainder', () => {
    const result = reconcileIncome({
      amountMinor: 10_000,
      currency: 'UYU',
      applications: [{ amountMinor: 6_000, currency: 'UYU', tenantId: 'tenant-1' }],
      tenantId: 'tenant-1',
    });
    expect(result.outcome).toBe('RECONCILED');
    expect(result.evidence).toEqual({ appliedMinor: 6_000, remainingMinor: 4_000 });
  });

  it('blocks income applications that exceed the Income amount without clamping', () => {
    const result = reconcileIncome({
      amountMinor: 10_000,
      currency: 'ARS',
      applications: [{ amountMinor: 12_000, currency: 'ARS', tenantId: 'tenant-1' }],
      tenantId: 'tenant-1',
    });
    expect(result.outcome).toBe('INVALID_BLOCKING');
    expect(result.evidence).toEqual({ appliedMinor: 12_000, remainingMinor: -2_000 });
  });

  it('reconciles FUND provenance without duplicate accounting effect', () => {
    expect(reconcileFundTransaction({
      tenantId: 'tenant-1',
      fundId: 'fund-1',
      direction: 'CREDIT',
      amountMinor: 500,
      currency: 'UYU',
      application: {
        tenantId: 'tenant-1',
        fundId: 'fund-1',
        destinationType: 'FUND',
        amountMinor: 500,
        currency: 'UYU',
      },
    }).outcome).toBe('LEGACY_RECONCILED');
  });

  it('blocks duplicate equivalent FundTransactions', () => {
    const result = reconcileFundTransaction({
      tenantId: 'tenant-1',
      fundId: 'fund-1',
      direction: 'CREDIT',
      amountMinor: 500,
      currency: 'UYU',
      duplicateTransactionCount: 1,
      application: {
        tenantId: 'tenant-1',
        fundId: 'fund-1',
        destinationType: 'FUND',
        amountMinor: 500,
        currency: 'UYU',
      },
    });
    expect(result.outcome).toBe('INVALID_BLOCKING');
    expect(result.findings.map((finding) => finding.code)).toContain('DUPLICATE_FUND_EFFECT');
  });

  it('uses persisted offset valuation and ownership evidence', () => {
    expect(reconcileLiquidationIncomeOffset({
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      liquidation: { tenantId: 'tenant-1', buildingId: 'building-1', baseCurrency: 'ARS' },
      application: { tenantId: 'tenant-1', amountMinor: 100, currency: 'USD' },
      originalAmountMinor: 100,
      currency: 'USD',
      valuedAmountMinor: 18_250,
      baseCurrency: 'ARS',
      persistedConversion: { valuedAmountMinor: 18_250, baseCurrency: 'ARS' },
    }).outcome).toBe('RECONCILED');
  });

  it('blocks conflicting frozen offset conversion evidence', () => {
    const result = reconcileLiquidationIncomeOffset({
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      liquidation: { tenantId: 'tenant-1', buildingId: 'building-1', baseCurrency: 'ARS' },
      application: { tenantId: 'tenant-1', amountMinor: 100, currency: 'USD' },
      originalAmountMinor: 100,
      currency: 'USD',
      valuedAmountMinor: 18_250,
      baseCurrency: 'ARS',
      persistedConversion: { valuedAmountMinor: 18_251, baseCurrency: 'ARS' },
    });
    expect(result.outcome).toBe('INVALID_BLOCKING');
  });

  it('blocks missing current-format expense snapshot evidence', () => {
    const result = reconcileExpenseLiquidation({
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      amountMinor: 100,
      currency: 'ARS',
    });
    expect(result.outcome).toBe('INVALID_BLOCKING');
  });

  it('keeps Expense out of direct debt and accepts valid legacy missing snapshot fields', () => {
    const result = reconcileExpenseLiquidation({
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      amountMinor: 100,
      currency: 'UYU',
      snapshot: null,
      legacySnapshotFieldsMissing: true,
    });
    expect(result.outcome).toBe('LEGACY_RECONCILED');
    expect(result.evidence?.directDebtEffectMinor).toBe(0);
  });

  it('does not assume every adjustment reduces debt', () => {
    expect(reconcileAdjustment({
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      sourcePeriod: '2026-01',
      targetPeriod: '2026-02',
      amountMinor: 100,
      currency: 'UYU',
      status: 'VALIDATED',
      accountingEffect: 'ADDS_TO_LIQUIDATION',
    }).outcome).toBe('LEGACY_RECONCILED');
  });
});
