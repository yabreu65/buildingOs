import { getTotalAccumulatedDebtByCurrency } from './building-alerts';

describe('dashboard building alerts utils', () => {
  it('rolls multi-building debt up by currency without mixing nominal amounts', () => {
    expect(
      getTotalAccumulatedDebtByCurrency([
        {
          buildingId: 'b1',
          buildingName: 'Torre del Parque',
          outstandingByCurrency: [
            { currency: 'USD', amountMinor: 5000 },
            { currency: 'ARS', amountMinor: 198200 },
          ],
          overdueTickets: 2,
          unitsWithoutResponsible: 1,
          riskScore: 'MEDIUM',
        },
        {
          buildingId: 'b2',
          buildingName: 'Edificio del Río',
          outstandingByCurrency: [
            { currency: 'USD', amountMinor: 2500 },
            { currency: 'ARS', amountMinor: 474600 },
          ],
          overdueTickets: 1,
          unitsWithoutResponsible: 0,
          riskScore: 'LOW',
        },
      ]),
    ).toEqual([
      { currency: 'USD', amountMinor: 7500 },
      { currency: 'ARS', amountMinor: 672800 },
    ]);
  });

  it('returns no currency bucket when alerts have no debt', () => {
    expect(
      getTotalAccumulatedDebtByCurrency([
        {
          buildingId: 'b1',
          buildingName: 'Torre del Parque',
          outstandingByCurrency: [],
          overdueTickets: 0,
          unitsWithoutResponsible: 0,
          riskScore: 'LOW',
        },
      ]),
    ).toEqual([]);
  });
});
