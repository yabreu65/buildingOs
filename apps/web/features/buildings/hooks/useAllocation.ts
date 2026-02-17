import { useState } from 'react';
import { getPaymentAllocations, createAllocations, PaymentAllocation } from '../services/finance.api';

export function useAllocation(buildingId: string) {
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAllocations = async (paymentId: string) => {
    try {
      setLoading(true);
      setError(null);
      const data = await getPaymentAllocations(buildingId, paymentId);
      setAllocations(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load allocations');
      setAllocations([]);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const allocate = async (paymentId: string, allocs: Array<{ chargeId: string; amount: number }>) => {
    try {
      setLoading(true);
      setError(null);
      const newAllocations = await createAllocations(buildingId, paymentId, allocs);
      setAllocations([...allocations, ...newAllocations]);
      return newAllocations;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create allocations');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { allocations, loading, error, fetchAllocations, allocate };
}
