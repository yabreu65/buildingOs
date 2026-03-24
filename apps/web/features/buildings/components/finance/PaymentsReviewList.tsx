'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Badge from '@/shared/components/ui/Badge';
import Skeleton from '@/shared/components/ui/Skeleton';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import { useToast } from '@/shared/components/ui/Toast';
import { Payment } from '../../services/finance.api';
import { usePaymentsReview } from '../../hooks/usePaymentsReview';
import { PaymentApproveModal } from './PaymentApproveModal';
import { CheckCircle, XCircle } from 'lucide-react';

interface PaymentsReviewListProps {
  buildingId: string;
  payments: Payment[];
  loading: boolean;
  error: string | null;
  onPaymentApproved: () => Promise<void>;
  onPaymentRejected: () => Promise<void>;
  onRefresh?: () => Promise<void>;
}

/**
 * PaymentsReviewList: Display pending payments with approve/reject actions
 */
export function PaymentsReviewList({
  buildingId,
  payments,
  loading,
  error,
  onPaymentApproved,
  onPaymentRejected,
  onRefresh,
}: PaymentsReviewListProps) {
  const { toast } = useToast();
  const { approve, reject } = usePaymentsReview(buildingId, 'SUBMITTED');
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  if (error) {
    return <ErrorState message={error} onRetry={onRefresh} />;
  }

  if (!loading && payments.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle className="w-12 h-12 text-muted-foreground" />}
        title="No hay pagos pendientes"
        description="Todos los pagos han sido revisados"
      />
    );
  }

  const handleApproveClick = (paymentId: string) => {
    setSelectedPaymentId(paymentId);
  };

  const handleConfirmApprove = async (paidAt?: string) => {
    if (!selectedPaymentId) return;
    try {
      setIsApproving(true);
      await approve(selectedPaymentId, paidAt);
      toast('Pago aprobado', 'success');
      await onPaymentApproved();
      setSelectedPaymentId(null);
    } catch (err) {
      toast('Error al aprobar pago', 'error');
    } finally {
      setIsApproving(false);
    }
  };

  const handleRejectClick = async (paymentId: string) => {
    try {
      setIsRejecting(true);
      await reject(paymentId);
      toast('Pago rechazado', 'success');
      await onPaymentRejected();
    } catch (err) {
      toast('Error al rechazar pago', 'error');
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <>
      <Card>
        {loading ? (
          <div className="p-4 space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>Unidad</TH>
                <TH>Monto</TH>
                <TH>Método</TH>
                <TH className="text-right">Acciones</TH>
              </TR>
            </THead>
            <TBody>
              {payments.map((payment) => (
                <TR key={payment.id}>
                  <TD>{new Date(payment.createdAt).toLocaleDateString()}</TD>
                  <TD className="font-medium">{payment.unitId || 'N/A'}</TD>
                  <TD>
                    {payment.currency} {payment.amount.toFixed(2)}
                  </TD>
                  <TD>
                    <Badge className="bg-blue-100 text-blue-800">
                      {payment.method}
                    </Badge>
                  </TD>
                  <TD className="text-right flex gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleApproveClick(payment.id)}
                      disabled={isApproving}
                      className="text-green-600 hover:text-green-700 gap-1"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Aprobar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRejectClick(payment.id)}
                      disabled={isRejecting}
                      className="text-red-600 hover:text-red-700 gap-1"
                    >
                      <XCircle className="w-4 h-4" />
                      Rechazar
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {selectedPaymentId && (
        <PaymentApproveModal
          paymentId={selectedPaymentId}
          onConfirm={handleConfirmApprove}
          onCancel={() => setSelectedPaymentId(null)}
          isSubmitting={isApproving}
        />
      )}
    </>
  );
}
