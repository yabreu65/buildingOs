'use client';

import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { listPayments, setPaymentStatus, removePayment } from './payments.storage';
import { Table, THead, TR, TH, TBody, TD } from '../../shared/components/ui/Table';
import Button from '../../shared/components/ui/Button';
import Badge from '../../shared/components/ui/Badge';
import { formatMoney } from '../../shared/lib/format/money';
import { formatDate } from '../../shared/lib/format/date';
import { useCan } from '../rbac/rbac.hooks';
import { useBoStorageTick } from '../../shared/lib/storage/useBoStorage';

export default function PaymentsReviewUI() {
  const params = useParams();
  const tenantId = params?.tenantId as string | undefined;

  // Re-render cuando cambie el storage
  useBoStorageTick();

  const canReview = useCan('payments.review');

  // Cargar payments del storage
  const payments = useMemo(() => {
    if (!tenantId) return [];
    return listPayments(tenantId);
  }, [tenantId]);

  const handleApprove = (paymentId: string) => {
    if (!tenantId) return;
    setPaymentStatus(tenantId, paymentId, 'APPROVED');
  };

  const handleReject = (paymentId: string) => {
    if (!tenantId) return;
    setPaymentStatus(tenantId, paymentId, 'REJECTED');
  };

  const handleRemove = (paymentId: string) => {
    if (!tenantId) return;
    removePayment(tenantId, paymentId);
  };

  if (!tenantId) {
    return <div className="text-sm text-muted-foreground">Sin tenant activo</div>;
  }

  if (payments.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Payments Review</h3>
        </div>
        <div className="text-sm text-muted-foreground text-center py-8">
          Sin pagos registrados aún
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Payments Review</h3>
        <span className="text-xs text-muted-foreground">{payments.length} pago(s)</span>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Unit</TH>
            <TH>Amount</TH>
            <TH>Status</TH>
            <TH>Date</TH>
            <TH>Actions</TH>
          </TR>
        </THead>
        <TBody>
          {payments.map((p) => (
            <TR key={p.id}>
              <TD>{p.unitId}</TD>
              <TD>{formatMoney(p.amount)}</TD>
              <TD>
                <Badge
                  className={
                    p.status === 'APPROVED'
                      ? 'bg-green-100 text-green-800'
                      : p.status === 'REJECTED'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-yellow-100 text-yellow-800'
                  }
                >
                  {p.status}
                </Badge>
              </TD>
              <TD>{formatDate(new Date(p.createdAt))}</TD>
              <TD>
                {canReview ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      onClick={() => handleApprove(p.id)}
                      disabled={p.status !== 'PENDING'}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleReject(p.id)}
                      disabled={p.status !== 'PENDING'}
                    >
                      Reject
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleRemove(p.id)}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">Sin permisos</span>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
