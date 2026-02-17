import { useEffect, useState } from 'react';
import { getUnitLedger, submitPayment, UnitLedger, PaymentMethod } from '../services/finance.api';

export function useUnitLedger(unitId: string, periodFrom?: string, periodTo?: string) {
  const [ledger, setLedger] = useState<UnitLedger | null>(null);
  const [loading, setLoading] = useState(!!unitId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!unitId) {
      setLoading(false);
      return;
    }

    const fetch = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getUnitLedger(unitId, periodFrom, periodTo);
        setLedger(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load ledger');
        setLedger(null);
      } finally {
        setLoading(false);
      }
    };

    fetch();
  }, [unitId, periodFrom, periodTo]);

  const submitPaymentForUnit = async (data: {
    amount: number;
    currency?: string;
    method: PaymentMethod;
    reference?: string;
    paidAt?: string;
    proofFileId?: string;
  }) => {
    if (!ledger) throw new Error('Ledger not loaded');
    try {
      const payment = await submitPayment(ledger.buildingId, {
        unitId: ledger.unitId,
        ...data,
      });
      // Refresh ledger to show new payment
      await refetch();
      return payment;
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to submit payment');
    }
  };

  const refetch = async () => {
    if (!unitId) return;
    try {
      setLoading(true);
      const data = await getUnitLedger(unitId, periodFrom, periodTo);
      setLedger(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setLoading(false);
    }
  };

  return { ledger, loading, error, submitPaymentForUnit, refetch };
}
