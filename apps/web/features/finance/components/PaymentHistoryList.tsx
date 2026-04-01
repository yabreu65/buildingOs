'use client';

import { useState } from 'react';
import Card from '@/shared/components/ui/Card';
import Badge from '@/shared/components/ui/Badge';
import Skeleton from '@/shared/components/ui/Skeleton';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import { useToast } from '@/shared/components/ui/Toast';
import { Payment } from '../services/finance.api';
import { getDownloadUrl } from '@/features/buildings/services/documents.api';
import { CheckCircle, FileText, Loader2 } from 'lucide-react';
import { formatCurrency, getLocaleForCurrency } from '@/shared/lib/format/money';

interface PaymentHistoryListProps {
  buildingId: string;
  tenantId: string;
  payments: Payment[];
  loading: boolean;
  error: string | null;
  onRefresh?: () => Promise<void>;
}

/**
 * PaymentHistoryList: Display approved payments with proof download capability
 */
export function PaymentHistoryList({
  tenantId,
  payments,
  loading,
  error,
  onRefresh,
}: PaymentHistoryListProps) {
  const { toast } = useToast();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});

  const handleDownloadProof = async (paymentId: string, fileId: string) => {
    if (downloadUrls[paymentId]) {
      window.open(downloadUrls[paymentId], '_blank');
      return;
    }
    setDownloadingId(paymentId);
    try {
      const response = await getDownloadUrl(tenantId, fileId);
      setDownloadUrls((prev) => ({ ...prev, [paymentId]: response.url }));
      window.open(response.url, '_blank');
    } catch {
      toast('Error al descargar comprobante', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="p-6 space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      </Card>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={onRefresh} />;
  }

  if (!loading && payments.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle className="w-12 h-12 text-muted-foreground" />}
        title="Sin historial de pagos"
        description="No hay pagos aprobados aún"
      />
    );
  }

  return (
    <Card>
      <Table>
        <THead>
          <TR>
            <TH>Fecha</TH>
            <TH>Unidad</TH>
            <TH>Monto</TH>
            <TH>Método</TH>
            <TH>Comprobante</TH>
            <TH>Estado</TH>
          </TR>
        </THead>
        <TBody>
          {payments.map((payment) => (
            <TR key={payment.id}>
              <TD>{new Date(payment.createdAt).toLocaleDateString()}</TD>
              <TD className="font-medium">{payment.unit?.label || payment.unitId || 'N/A'}</TD>
              <TD>
                {formatCurrency(payment.amount, payment.currency, getLocaleForCurrency(payment.currency))}
              </TD>
              <TD>
                <Badge className="bg-blue-100 text-blue-800">
                  {payment.method}
                </Badge>
              </TD>
              <TD>
                {payment.proofFileId ? (
                  <button
                    onClick={() => handleDownloadProof(payment.id, payment.proofFileId!)}
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
                ) : (
                  <span className="text-muted-foreground text-sm">Sin comprobante</span>
                )}
              </TD>
              <TD>
                <Badge className="bg-green-100 text-green-800">
                  Aprobado
                </Badge>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}
