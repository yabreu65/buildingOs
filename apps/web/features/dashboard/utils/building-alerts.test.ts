import { getTotalAccumulatedDebt } from './building-alerts';

describe('dashboard building alerts utils', () => {
  it('sums accumulated debt across buildings in cents', () => {
    expect(
      getTotalAccumulatedDebt([
        {
          buildingId: 'b1',
          buildingName: 'Torre del Parque',
          outstandingAmount: 198200,
          overdueTickets: 2,
          unitsWithoutResponsible: 1,
          riskScore: 'MEDIUM',
        },
        {
          buildingId: 'b2',
          buildingName: 'Edificio del Río',
          outstandingAmount: 474600,
          overdueTickets: 1,
          unitsWithoutResponsible: 0,
          riskScore: 'LOW',
        },
      ]),
    ).toBe(672800);
  });

  it('treats missing debt as zero', () => {
    expect(
      getTotalAccumulatedDebt([
        {
          buildingId: 'b1',
          buildingName: 'Torre del Parque',
          outstandingAmount: 0,
          overdueTickets: 0,
          unitsWithoutResponsible: 0,
          riskScore: 'LOW',
        },
      ]),
    ).toBe(0);
  });
});
