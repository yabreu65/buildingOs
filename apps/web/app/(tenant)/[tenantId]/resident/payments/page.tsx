'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CreditCard,
  AlertCircle,
  CheckCircle,
  DollarSign,
  Upload,
  Loader2,
  FileText,
} from 'lucide-react';

import { useResidentContext } from '@/features/resident/hooks/useResidentContext';
import { getResidentLedger, type UnitLedger } from '@/features/resident/api/resident-context.api';
import { getContextOptions } from '@/features/context/context.api';
import { useTenants } from '@/features/tenants/tenants.hooks';
import { listPayments, submitPayment, type Payment, PaymentMethod, ChargeStatus } from '@/features/finance/services/finance.api';
import { apiClient } from '@/shared/lib/http/client';
import { getDownloadUrl } from '@/features/buildings/services/documents.api';
import type { ContextOption } from '@/features/context/context.types';
import Card from '@/shared/components/ui/Card';
import Input from '@/shared/components/ui/Input';
import Select from '@/shared/components/ui/Select';
import Button from '@/shared/components/ui/Button';
import Skeleton from '@/shared/components/ui/Skeleton';
import { formatCurrency, toCents, getLocaleForCurrency } from '@/shared/lib/format/money';

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(dateStr));
}

function getChargeStatusFromDebt(amount: number, allocated: number | undefined, status: ChargeStatus): string {
  const debt = amount - (allocated ?? 0);
  if (status === ChargeStatus.CANCELED) return 'Cancelado';
  if (debt <= 0) return 'Pagado';
  if (allocated && allocated > 0 && allocated < amount) return 'Parcial';
  return 'Pendiente';
}

function paymentStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    SUBMITTED: 'Enviado',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado',
    RECONCILED: 'Conciliado',
  };
  return labels[status] ?? status;
}

function paymentStatusColor(status: string): string {
  const colors: Record<string, string> = {
    SUBMITTED: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    APPROVED: 'bg-green-100 text-green-700 border-green-200',
    REJECTED: 'bg-red-100 text-red-700 border-red-200',
    RECONCILED: 'bg-blue-100 text-blue-700 border-blue-200',
  };
  return colors[status] ?? 'bg-muted text-muted-foreground border-border';
}

interface PaymentFormData {
  amount: number;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
  proofFileId?: string;
}

interface PresignResponse {
  url: string;
  bucket: string;
  objectKey: string;
  expiresAt: string;
}

const ResidentPaymentsPage = () => {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;

  const { data: tenants } = useTenants();
  const tenantName = tenants?.find((t) => t.id === tenantId)?.name ?? tenantId;

  const { data: context } = useResidentContext(tenantId ?? null);
  const buildingId = context?.activeBuildingId ?? null;
  const unitId = context?.activeUnitId ?? null;

  const { data: contextOptions } = useQuery<{ buildings: ContextOption[]; unitsByBuilding: Record<string, ContextOption[]> }>({
    queryKey: ['contextOptions', tenantId],
    queryFn: () => getContextOptions(tenantId!),
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
  });

  const buildingName = contextOptions?.buildings.find((b) => b.id === buildingId)?.name ?? null;
  const unitLabel = buildingId && unitId ? contextOptions?.unitsByBuilding[buildingId]?.find((u) => u.id === unitId)?.label ?? null : null;

  const { data: ledger, isLoading: ledgerLoading, refetch: refetchLedger } = useQuery<UnitLedger>({
    queryKey: ['residentLedger', unitId],
    queryFn: () => getResidentLedger(unitId!),
    enabled: !!unitId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: payments = [], isLoading: paymentsLoading } = useQuery<Payment[]>({
    queryKey: ['residentPayments', buildingId, unitId],
    queryFn: () => listPayments(buildingId!, undefined, unitId ?? undefined, 20),
    enabled: !!buildingId && !!unitId,
    staleTime: 5 * 60 * 1000,
  });

  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<PaymentFormData>({
    amount: 0,
    method: PaymentMethod.TRANSFER,
    reference: '',
    paidAt: new Date().toISOString().split('T')[0],
  });
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofFileId, setProofFileId] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});

  const handleViewProof = async (paymentId: string, fileId: string) => {
    if (downloadUrls[paymentId]) {
      window.open(downloadUrls[paymentId], '_blank');
      return;
    }
    setDownloadingId(paymentId);
    try {
      const response = await getDownloadUrl(tenantId, fileId);
      setDownloadUrls((prev) => ({ ...prev, [paymentId]: response.url }));
      window.open(response.url, '_blank');
    } catch (error) {
      console.error('Error downloading proof:', error);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId) return;
    
    if (file.size > 10 * 1024 * 1024) {
      setSubmitError('El archivo no puede superar 10MB');
      return;
    }

    setUploadingProof(true);
    setSubmitError(null);

    try {
      const presignRes = await apiClient<PresignResponse, { originalName: string; mimeType: string }>({
        path: `/tenants/${tenantId}/documents/presign`,
        method: 'POST',
        body: {
          originalName: file.name,
          mimeType: file.type,
        },
      });

      await fetch(presignRes.url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });

      const createRes = await apiClient<{ fileId: string }, { title: string; category: string; visibility: string; objectKey: string; size: number; unitId?: string }>({
        path: `/tenants/${tenantId}/documents`,
        method: 'POST',
        body: {
          title: `Comprobante pago - ${file.name}`,
          category: 'RECEIPT',
          visibility: 'TENANT_ADMIN',
          objectKey: presignRes.objectKey,
          size: file.size,
          unitId: unitId ?? undefined,
        },
      });

      setProofFile(file);
      setProofFileId(createRes.fileId);
    } catch (error) {
      console.error('Error uploading proof:', error);
      setSubmitError('Error al subir el comprobante. Podés enviar sin comprobante.');
    } finally {
      setUploadingProof(false);
    }
  };

  const resetForm = () => {
    setFormData({
      amount: 0,
      method: PaymentMethod.TRANSFER,
      reference: '',
      paidAt: new Date().toISOString().split('T')[0],
    });
    setProofFile(null);
    setProofFileId(null);
  };

  const pendingCharges = ledger?.charges?.filter(
    (c) => (c.amount - (c.allocated ?? 0)) > 0
  ) ?? [];

  const balance = ledger?.totals?.balance ?? 0;
  const currency = ledger?.totals?.currency ?? 'ARS';

  const nextDueCharge = ledger?.charges
    ?.filter((c) => c.status === ChargeStatus.PENDING || c.status === ChargeStatus.PARTIAL)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  const lastPayment = ledger?.payments
    ?.slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buildingId || !unitId) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      await submitPayment(buildingId, {
        unitId,
        amount: toCents(formData.amount),
        currency,
        method: formData.method,
        reference: formData.reference || undefined,
        paidAt: formData.paidAt || undefined,
        proofFileId: proofFileId || undefined,
      });

      setSubmitSuccess(true);
      resetForm();
      setTimeout(() => {
        setShowForm(false);
        setSubmitSuccess(false);
      }, 2000);
      refetchLedger();
      setTimeout(() => {
        setShowForm(false);
        setSubmitSuccess(false);
      }, 2000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Error al enviar pago');
    } finally {
      setSubmitting(false);
    }
  };

  if (!unitId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Pagos</h1>
          <p className="text-muted-foreground">{tenantName}</p>
        </div>
        <Card className="p-6 border-yellow-300 bg-yellow-50">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-yellow-600" size={24} />
            <div>
              <p className="font-medium text-yellow-800">Sin unidad asignada</p>
              <p className="text-sm text-yellow-700">No tenés una unidad asignada. Comunicate con la administración.</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (ledgerLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Pagos</h1>
        <p className="text-muted-foreground">
          {tenantName}
          {buildingName && ` • ${buildingName}`}
          {unitLabel && ` • Unidad ${unitLabel}`}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-start gap-3">
            {balance > 0 ? (
              <AlertCircle className="text-orange-500 mt-0.5" size={22} />
            ) : (
              <CheckCircle className="text-green-500 mt-0.5" size={22} />
            )}
            <div>
              <p className="text-sm font-medium text-muted-foreground">Saldo pendiente</p>
              <p className={`text-2xl font-bold ${balance > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                {formatCurrency(balance, currency, getLocaleForCurrency(currency))}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start gap-3">
            <DollarSign className="text-blue-500 mt-0.5" size={22} />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Próximo vencimiento</p>
              <p className="text-2xl font-bold text-gray-900">
                {nextDueCharge ? formatDate(nextDueCharge.dueDate) : '—'}
              </p>
              {nextDueCharge && (
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(nextDueCharge.amount, currency, getLocaleForCurrency(currency))}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start gap-3">
            <CreditCard className="text-green-500 mt-0.5" size={22} />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Último pago</p>
              <p className="text-2xl font-bold text-gray-900">
                {lastPayment ? formatCurrency(lastPayment.amount, lastPayment.currency, getLocaleForCurrency(lastPayment.currency)) : '—'}
              </p>
              {lastPayment && (
                <p className="text-xs text-muted-foreground">
                  {formatDate(lastPayment.paidAt ?? lastPayment.createdAt)}
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Pending Charges */}
      <Card className="p-4">
        <h3 className="font-semibold text-lg mb-4">Cargos pendientes</h3>
        {pendingCharges.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6">
            <CheckCircle className="w-8 h-8 text-green-600 mb-2" />
            <p className="text-muted-foreground">Sin cargos pendientes</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingCharges.map((charge) => (
              <div key={charge.id} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium">{charge.concept}</p>
                  <p className="text-sm text-muted-foreground">{charge.period} • Vence: {formatDate(charge.dueDate)}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{formatCurrency(charge.amount - (charge.allocated ?? 0), charge.currency, getLocaleForCurrency(charge.currency))}</p>
                  <p className="text-xs text-muted-foreground">{getChargeStatusFromDebt(charge.amount, charge.allocated, charge.status)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Payment History */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Historial de pagos</h3>
          <Button onClick={() => setShowForm(!showForm)} className="gap-2">
            <Upload size={16} />
            Reportar pago
          </Button>
        </div>

        {paymentsLoading ? (
          <Skeleton className="h-32" />
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6">
            <p className="text-muted-foreground">Sin pagos registrados</p>
          </div>
        ) : (
          <div className="space-y-2">
            {payments.map((payment) => (
              <div key={payment.id} className="flex justify-between items-start gap-3 p-3 bg-muted/50 rounded-lg">
                <div className="flex-1">
                  <p className="font-medium">{formatCurrency(payment.amount, payment.currency, getLocaleForCurrency(payment.currency))}</p>
                  <p className="text-sm text-muted-foreground">
                    {payment.method} • {formatDate(payment.paidAt ?? payment.createdAt)}
                    {payment.reference && ` • ${payment.reference}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {payment.proofFileId && (
                    <button
                      onClick={() => handleViewProof(payment.id, payment.proofFileId!)}
                      disabled={downloadingId === payment.id}
                      className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm disabled:opacity-50"
                    >
                      {downloadingId === payment.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                      Ver
                    </button>
                  )}
                  <span className={`px-2 py-1 rounded text-xs font-medium border whitespace-nowrap ${paymentStatusColor(payment.status)}`}>
                    {paymentStatusLabel(payment.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Submit Payment Form */}
      {showForm && (
        <Card className="p-4">
          <h3 className="font-semibold text-lg mb-4">Reportar nuevo pago</h3>
          <form onSubmit={handleSubmitPayment} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Monto ({currency})</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="999999.99"
                  value={formData.amount || ''}
                  onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                  placeholder="Ej: 350.00"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Método de pago</label>
                <Select
                  value={formData.method}
                  onChange={(e) => setFormData({ ...formData, method: e.target.value as PaymentMethod })}
                >
                  <option value={PaymentMethod.TRANSFER}>Transferencia</option>
                  <option value={PaymentMethod.CASH}>Efectivo</option>
                  <option value={PaymentMethod.CARD}>Tarjeta</option>
                  <option value={PaymentMethod.ONLINE}>Pago online</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Fecha de pago</label>
                <Input
                  type="date"
                  value={formData.paidAt}
                  onChange={(e) => setFormData({ ...formData, paidAt: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Referencia (opcional)</label>
                <Input
                  type="text"
                  value={formData.reference}
                  onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                  placeholder="Ej: Transferencia #12345"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Comprobante de pago (opcional)</label>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileChange}
                className="block w-full text-sm text-muted-foreground
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-medium
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100"
              />
              {proofFile && (
                <p className="text-sm text-green-600 mt-1">
                  ✓ {proofFile.name} subido correctamente
                </p>
              )}
              {uploadingProof && (
                <p className="text-sm text-blue-600 mt-1 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Subiendo comprobante...
                </p>
              )}
            </div>

            {submitError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{submitError}</p>
              </div>
            )}

            {submitSuccess && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-600">✓ Pago enviado exitosamente</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={submitting} className="gap-2">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? 'Enviando...' : 'Enviar pago'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
};

export default ResidentPaymentsPage;
