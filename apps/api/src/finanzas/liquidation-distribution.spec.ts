import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildLiquidationDistributionSnapshot,
  distributeLiquidationMovements,
  parseLiquidationDistributionSnapshot,
} from './liquidation-distribution';

describe('liquidation distribution', () => {
  const buildingRecipients = [
    { unitId: 'unit-b', unitCode: 'B', unitLabel: 'B', coefficient: 1, m2: 10 },
    { unitId: 'unit-a', unitCode: 'A', unitLabel: 'A', coefficient: 1, m2: 10 },
  ];

  it('uses Decimal HALF_EVEN rounding and unitId residual tie-breaking', () => {
    const result = distributeLiquidationMovements({
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      totalAmountMinor: 5,
      movements: [
        {
          movementId: 'expense-1',
          scope: 'BUILDING',
          amountMinor: 5,
          recipients: buildingRecipients,
        },
      ],
    });

    expect(result.allocations).toEqual([
      expect.objectContaining({ unitId: 'unit-a', amountMinor: 3 }),
      expect.objectContaining({ unitId: 'unit-b', amountMinor: 2 }),
    ]);
    expect(result.movements[0]).toMatchObject({
      movementId: 'expense-1',
      weightSource: 'COEFFICIENT',
      amountMinor: 5,
      recipientUnitIds: ['unit-a', 'unit-b'],
    });
  });

  it('preserves each movement recipient population and reconciles the net total', () => {
    const result = distributeLiquidationMovements({
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      totalAmountMinor: 90,
      movements: [
        {
          movementId: 'building-expense',
          scope: 'BUILDING',
          amountMinor: 60,
          recipients: buildingRecipients,
        },
        {
          movementId: 'group-expense',
          scope: 'UNIT_GROUP',
          unitGroupId: 'group-1',
          amountMinor: 40,
          recipients: [buildingRecipients[0]!],
        },
      ],
    });

    expect(result.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movementId: 'group-expense',
          recipientUnitIds: ['unit-b'],
          amountMinor: 36,
        }),
      ]),
    );
    expect(result.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0)).toBe(90);
  });

  it('freezes normalized Decimal evidence and rejects malformed snapshots', () => {
    const distribution = distributeLiquidationMovements({
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      totalAmountMinor: 10,
      movements: [
        {
          movementId: 'expense-1',
          scope: 'BUILDING',
          amountMinor: 10,
          recipients: buildingRecipients,
        },
      ],
    });
    const snapshot = buildLiquidationDistributionSnapshot(distribution);

    expect(snapshot).toMatchObject({ version: 1, totalAmountMinor: 10 });
    expect(snapshot.movements[0]).toMatchObject({
      recipients: expect.arrayContaining([
        expect.objectContaining({ coefficient: '1', m2: '10' }),
      ]),
    });
    expect(parseLiquidationDistributionSnapshot(snapshot)).toEqual(snapshot);
    expect(() => parseLiquidationDistributionSnapshot({ ...snapshot, version: 2 })).toThrow(
      BadRequestException,
    );
  });

  it('fails closed on duplicate or non-reconciling frozen snapshot allocations', () => {
    const distribution = distributeLiquidationMovements({
      tenantId: 'tenant-1', buildingId: 'building-1', totalAmountMinor: 10,
      movements: [{
        movementId: 'expense-1', scope: 'BUILDING', amountMinor: 10, recipients: buildingRecipients,
      }],
    });
    const snapshot = buildLiquidationDistributionSnapshot(distribution);

    expect(() => parseLiquidationDistributionSnapshot({
      ...snapshot,
      allocations: [...snapshot.allocations, snapshot.allocations[0]],
    })).toThrow(BadRequestException);
    expect(() => parseLiquidationDistributionSnapshot({
      ...snapshot,
      allocations: snapshot.allocations.map((allocation) => ({ ...allocation, amountMinor: 0 })),
    })).toThrow(BadRequestException);
    expect(() => parseLiquidationDistributionSnapshot({
      ...snapshot,
      movements: snapshot.movements.map((movement) => ({
        ...movement,
        recipientUnitIds: [],
        recipients: [],
        allocations: [],
      })),
    })).toThrow(BadRequestException);
  });

  it('rejects non-finite Float-backed allocation inputs before Decimal conversion', () => {
    expect(() =>
      distributeLiquidationMovements({
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        totalAmountMinor: 10,
        movements: [
          {
            movementId: 'expense-1',
            scope: 'BUILDING',
            amountMinor: 10,
            recipients: [
              {
                unitId: 'unit-1',
                unitCode: '1',
                unitLabel: null,
                coefficient: Number.NaN,
                m2: 10,
              },
            ],
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('uses Prisma.Decimal values without JavaScript floating point allocation arithmetic', () => {
    const result = distributeLiquidationMovements({
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      totalAmountMinor: 100,
      movements: [
        {
          movementId: 'expense-1',
          scope: 'BUILDING',
          amountMinor: 100,
          recipients: [
            { unitId: 'unit-1', unitCode: '1', unitLabel: null, coefficient: 0.1, m2: 1 },
            { unitId: 'unit-2', unitCode: '2', unitLabel: null, coefficient: 0.2, m2: 1 },
          ],
        },
      ],
    });

    expect(result.allocations.map((allocation) => allocation.amountMinor)).toEqual([33, 67]);
    expect(Prisma.Decimal).toBeDefined();
  });
});
