'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { CreditCard } from 'lucide-react';

type BuildingParams = {
  tenantId: string;
  buildingId: string;
};

interface Payment {
  id: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'OVERDUE';
  createdAt: string;
}

/**
 * PaymentsPage: Show payment records from localStorage
 */
export default function PaymentsPage() {
  const params = useParams<BuildingParams>();
  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;

  const [payments, setPayments] = useState<Payment[]>([]);

  // Load payments from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined' && tenantId) {
      try {
        const raw = localStorage.getItem(`bo_payments_${tenantId}`);
        const data = raw ? JSON.parse(raw) : [];
        setPayments(data);
      } catch (err) {
        // Silently ignore localStorage errors
      }
    }
  }, [tenantId]);

  if (!tenantId || !buildingId) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingName="Payments"
        buildingId={buildingId}
      />

      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      {payments.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="w-12 h-12 text-muted-foreground" />}
          title="No Payment Records"
          description="No payment records yet for this building."
        />
      ) : (
        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-semibold">Payment Records</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Amount</th>
                  <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Status</th>
                  <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b hover:bg-muted/50 transition">
                    <td className="py-3 px-4 font-medium">${payment.amount.toFixed(2)}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded-full ${
                          payment.status === 'PAID'
                            ? 'bg-green-100 text-green-700'
                            : payment.status === 'OVERDUE'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-orange-100 text-orange-700'
                        }`}
                      >
                        {payment.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {new Date(payment.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
