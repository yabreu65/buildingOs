import { incomeApplicationProvenance } from './income-application-provenance';

describe('incomeApplicationProvenance', () => {
  it('labels a manual application (no provenance fields)', () => {
    expect(incomeApplicationProvenance({ policyVersionId: null, legacyDestination: null })).toEqual({
      origin: 'MANUAL',
      policyVersionId: null,
      legacyDestination: null,
    });
  });

  it('labels a policy application with its version', () => {
    expect(incomeApplicationProvenance({ policyVersionId: 'version-1', legacyDestination: null })).toEqual({
      origin: 'POLICY',
      policyVersionId: 'version-1',
      legacyDestination: null,
    });
  });

  it('labels a legacy application with its destination', () => {
    expect(incomeApplicationProvenance({ policyVersionId: null, legacyDestination: 'RESERVE_FUND' })).toEqual({
      origin: 'LEGACY',
      policyVersionId: null,
      legacyDestination: 'RESERVE_FUND',
    });
  });

  it('fails closed on malformed policy+legacy combination', () => {
    expect(incomeApplicationProvenance({ policyVersionId: 'version-1', legacyDestination: 'RESERVE_FUND' })).toEqual({
      origin: 'INVALID',
      policyVersionId: 'version-1',
      legacyDestination: 'RESERVE_FUND',
    });
  });
});
