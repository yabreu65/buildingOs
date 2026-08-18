import { HttpError } from '@/shared/lib/http/client';
import { liquidationDomainErrorMessage } from './liquidation-domain-error';

describe('liquidationDomainErrorMessage', () => {
  it('maps LIQUIDATION_INCOME_OFFSETS_EXCEED_GROSS', () => {
    const err = new HttpError(422, 'Unprocessable', 'boom', {
      error: 'LIQUIDATION_INCOME_OFFSETS_EXCEED_GROSS',
      message: 'boom',
    });
    expect(liquidationDomainErrorMessage(err, 'fallback')).toContain(
      'superan el subtotal distribuible',
    );
  });

  it('maps LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED', () => {
    const err = new HttpError(422, 'Unprocessable', 'boom', {
      error: 'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
    });
    expect(liquidationDomainErrorMessage(err, 'fallback')).toContain(
      'valuación funcional congelada',
    );
  });

  it('maps LIQUIDATION_INCOME_SOURCE_DRIFT', () => {
    const err = new HttpError(422, 'Unprocessable', 'boom', {
      error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
    });
    expect(liquidationDomainErrorMessage(err, 'fallback')).toContain(
      'Cancelá y regenerá',
    );
  });

  it('keeps the original message for non-domain errors', () => {
    const err = new HttpError(400, 'Bad Request', 'mensaje original', {
      error: 'SOMETHING_ELSE',
    });
    expect(liquidationDomainErrorMessage(err, 'fallback')).toBe('mensaje original');
  });

  it('returns the fallback for a plain unknown error', () => {
    expect(liquidationDomainErrorMessage({}, 'fallback')).toBe('fallback');
  });
});
