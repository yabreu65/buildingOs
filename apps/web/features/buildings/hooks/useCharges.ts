import { useEffect, useState } from 'react';
import { listCharges, createCharge, cancelCharge, Charge, ChargeType } from '../services/finance.api';

export function useCharges(buildingId: string, period?: string, unitId?: string) {
  const [charges, setCharges] = useState<Charge[]>([]);
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
        const data = await listCharges(buildingId, period, unitId);
        setCharges(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load charges');
        setCharges([]);
      } finally {
        setLoading(false);
      }
    };

    fetch();
  }, [buildingId, period, unitId]);

  const create = async (data: {
    unitId: string;
    type: ChargeType;
    concept: string;
    amount: number;
    currency?: string;
    period?: string;
    dueDate: string;
  }) => {
    try {
      const newCharge = await createCharge(buildingId, data);
      setCharges([newCharge, ...charges]);
      return newCharge;
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to create charge');
    }
  };

  const cancel = async (chargeId: string) => {
    try {
      await cancelCharge(buildingId, chargeId);
      setCharges(charges.map((c) => (c.id === chargeId ? { ...c, status: 'CANCELED' as any } : c)));
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to cancel charge');
    }
  };

  const refetch = async () => {
    if (!buildingId) return;
    try {
      setLoading(true);
      const data = await listCharges(buildingId, period, unitId);
      setCharges(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setLoading(false);
    }
  };

  return { charges, loading, error, create, cancel, refetch };
}
