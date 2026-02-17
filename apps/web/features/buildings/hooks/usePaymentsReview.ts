import { useEffect, useState } from 'react';
import { listPayments, approvePayment, rejectPayment, Payment } from '../services/finance.api';

export function usePaymentsReview(buildingId: string, status?: string) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(!!buildingId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!buildingId) {
      setLoading(false);
      return;
    }

    const fetch = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await listPayments(buildingId, status || 'SUBMITTED');
        setPayments(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load payments');
        setPayments([]);
      } finally {
        setLoading(false);
      }
    };

    fetch();
  }, [buildingId, status]);

  const approve = async (paymentId: string, paidAt?: string) => {
    try {
      const updated = await approvePayment(buildingId, paymentId, paidAt);
      setPayments(payments.map((p) => (p.id === paymentId ? updated : p)));
      return updated;
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to approve payment');
    }
  };

  const reject = async (paymentId: string, reason?: string) => {
    try {
      const updated = await rejectPayment(buildingId, paymentId, reason);
      setPayments(payments.map((p) => (p.id === paymentId ? updated : p)));
      return updated;
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to reject payment');
    }
  };

  const refetch = async () => {
    if (!buildingId) return;
    try {
      setLoading(true);
      const data = await listPayments(buildingId, status || 'SUBMITTED');
      setPayments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setLoading(false);
    }
  };

  return { payments, loading, error, approve, reject, refetch };
}
