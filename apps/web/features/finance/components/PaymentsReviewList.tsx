'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Badge from '@/shared/components/ui/Badge';
import Skeleton from '@/shared/components/ui/Skeleton';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import { useToast } from '@/shared/components/ui/Toast';
import { Payment } from '../services/finance.api';
import { useApprovePayment, useRejectPayment } from '../hooks/usePaymentsReview';
import { PaymentApproveModal } from './PaymentApproveModal';
import { getDownloadUrl } from '@/features/buildings/services/documents.api';
import { CheckCircle, XCircle, FileText, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/shared/lib/format/money';

interface PaymentsReviewListProps {
  buildingId: string;
  tenantId: string;
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
  tenantId,
  payments,
  loading,
  error,
  onPaymentApproved,
  onPaymentRejected,
  onRefresh,
}: PaymentsReviewListProps) {
  const { toast } = useToast();
  const approveMutation = useApprovePayment(buildingId, 'SUBMITTED');
  const rejectMutation = useRejectPayment(buildingId, 'SUBMITTED');
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});

  const handleDownloadProof = async (paymentId: string, documentId: string) => {
    if (downloadUrls[paymentId]) {
      window.open(downloadUrls[paymentId], '_blank');
      return;
    }
    setDownloadingId(paymentId);
    try {
      const response = await getDownloadUrl(tenantId, documentId);
      setDownloadUrls((prev) => ({ ...prev, [paymentId]: response.url }));
      window.open(response.url, '_blank');
    } catch {
      toast('Error al descargar comprobante', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 p-4">
        <div className="space-y-3 text-center text-red-700">
          <p className="text-sm font-medium text-red-900">No pudimos cargar los pagos pendientes</p>
          <p className="text-sm">{error}</p>
          {onRefresh && (
            <Button size="sm" variant="secondary" onClick={onRefresh}>
              Reintentar
            </Button>
          )}
        </div>
      </Card>
    );
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
      await approveMutation.mutateAsync({ paymentId: selectedPaymentId, paidAt });
      toast('Pago aprobado', 'success');
      await onPaymentApproved();
      setSelectedPaymentId(null);
    } catch {
      toast('Error al aprobar pago', 'error');
    }
  };

  const handleRejectClick = async (paymentId: string) => {
    try {
      await rejectMutation.mutateAsync({ paymentId });
      toast('Pago rechazado', 'success');
      await onPaymentRejected();
    } catch {
      toast('Error al rechazar pago', 'error');
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
                <TH>Comprobante</TH>
                <TH className="text-right">Acciones</TH>
              </TR>
            </THead>
            <TBody>
              {payments.map((payment) => (
                <TR key={payment.id}>
                  <TD>{new Date(payment.createdAt).toLocaleDateString()}</TD>
                  <TD className="font-medium">{payment.unit?.label || payment.unitId || 'N/A'}</TD>
                  <TD>
                    {formatCurrency(payment.amount, payment.currency)}
                  </TD>
                  <TD>
                    <Badge className="bg-blue-100 text-blue-800">
                      {payment.method}
                    </Badge>
                  </TD>
                  <TD>
                    {payment.proofDocumentId ? (
                      <button
                        type="button"
                        aria-label={`Ver comprobante del pago pendiente de ${payment.unit?.label || payment.unitId || 'la unidad'}`}
                        onClick={() => handleDownloadProof(payment.id, payment.proofDocumentId!)}
                        disabled={downloadingId === payment.id}
                        className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm disabled:opacity-50"
                      >
                        {downloadingId === payment.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <FileText className="w-4 h-4" />
                        )}
                        Ver comprobante
                      </button>
                    ) : payment.proofFileId ? (
                      <span className="text-muted-foreground text-sm">Comprobante sin procesar</span>
                    ) : (
                      <span className="text-muted-foreground text-sm">Sin comprobante</span>
                    )}
                  </TD>
                  <TD className="text-right flex gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      aria-label={`Aprobar pago de ${payment.unit?.label || payment.unitId || 'la unidad'}`}
                      onClick={() => handleApproveClick(payment.id)}
                      disabled={approveMutation.isPending}
                      className="text-green-600 hover:text-green-700 gap-1"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Aprobar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      aria-label={`Rechazar pago de ${payment.unit?.label || payment.unitId || 'la unidad'}`}
                      onClick={() => handleRejectClick(payment.id)}
                      disabled={rejectMutation.isPending}
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
          isSubmitting={approveMutation.isPending}
        />
      )}
    </>
  );
}
