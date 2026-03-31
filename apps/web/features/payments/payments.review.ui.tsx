'use client';

import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { 
  listPendingPayments, 
  approvePaymentTenant, 
  rejectPaymentTenant,
  PendingPayment,
  PendingPaymentQuery,
  PaymentStatus,
  getPaymentMetrics,
  PaymentMetrics,
  getPaymentAuditLog,
  PaymentAuditLogEntry,
  checkPaymentDuplicate,
  PaymentDuplicateCheck,
} from '../finance/services/finance.api';
import { fetchBuildings } from '../buildings/services/buildings.api';
import { Table, THead, TR, TH, TBody, TD } from '../../shared/components/ui/Table';
import Button from '../../shared/components/ui/Button';
import Badge from '../../shared/components/ui/Badge';
import Input from '../../shared/components/ui/Input';
import Select from '../../shared/components/ui/Select';
import Card from '../../shared/components/ui/Card';
import { formatCurrency } from '../../shared/lib/format/money';
import { formatDate } from '../../shared/lib/format/date';
import { useCan } from '../rbac/rbac.hooks';
import { t } from '@/i18n';

const PAYMENT_STATUSES = [
  PaymentStatus.SUBMITTED,
  PaymentStatus.APPROVED,
  PaymentStatus.REJECTED,
  PaymentStatus.RECONCILED,
] as const;

const REJECTION_REASONS = [
  { value: 'MONTO_INCORRECTO', label: 'Monto incorrecto' },
  { value: 'REFERENCIA_INVALIDA', label: 'Referencia inválida' },
  { value: 'SIN_COMPROBANTE', label: 'Sin comprobante' },
  { value: 'COMPROBANTE_ILEGIBLE', label: 'Comprobante ilegible' },
  { value: 'PAGO_DUPLICADO', label: 'Pago duplicado' },
  { value: 'OTRO', label: 'Otro' },
];

export const PaymentsReviewUI = () => {
  const params = useParams();
  const tenantId = params?.tenantId as string | undefined;

  const canReview = useCan('payments.review');

  // State
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [buildings, setBuildings] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Filters
  const [filters, setFilters] = useState<PendingPaymentQuery>({
    status: PaymentStatus.SUBMITTED,
  });
  
  // Rejection modal
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectComment, setRejectComment] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');
  const [rejectOtherReason, setRejectOtherReason] = useState('');

  // Action states
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // Metrics
  const [metrics, setMetrics] = useState<PaymentMetrics | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);

  // Audit history modal
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<PaymentAuditLogEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Duplicate warning
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // Selected building tab
  const [selectedBuildingTab, setSelectedBuildingTab] = useState<string>('all');

  // Update filters when building tab changes and reload payments
  useEffect(() => {
    if (!tenantId) return;
    
    if (selectedBuildingTab === 'all') {
      const newFilters = { ...filters };
      delete newFilters.buildingId;
      setFilters(newFilters);
    } else {
      setFilters(prev => ({ ...prev, buildingId: selectedBuildingTab }));
    }
    
    // Reload payments when building changes
    loadPayments();
  }, [selectedBuildingTab, tenantId]);

  // Load data
  const loadPayments = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listPendingPayments(tenantId, filters);
      setPayments(data);
    } catch (err) {
      setError(t('payments.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  const loadBuildings = async () => {
    if (!tenantId) return;
    try {
      const data = await fetchBuildings(tenantId);
      setBuildings(data);
    } catch (err) {
      console.error(t('payments.errorLoading'), err);
    }
  };

  // Load metrics
  const loadMetrics = async () => {
    if (!tenantId) return;
    try {
      const data = await getPaymentMetrics(tenantId);
      setMetrics(data);
    } catch (err) {
      console.error(t('payments.errorLoading'), err);
    }
  };

  // Toggle metrics
  const handleToggleMetrics = async () => {
    if (!showMetrics) {
      await loadMetrics();
    }
    setShowMetrics(!showMetrics);
  };

  // View audit history
  const handleViewAudit = async (paymentId: string) => {
    if (!tenantId) return;
    setLoadingAudit(true);
    try {
      const logs = await getPaymentAuditLog(tenantId, paymentId, 10);
      setAuditLogs(logs);
      setSelectedPaymentId(paymentId);
      setShowAudit(true);
    } catch (err) {
      console.error('Error loading audit logs', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  // Approve payment
  const handleApprove = async (paymentId: string) => {
    if (!tenantId) return;
    setApprovingId(paymentId);
    try {
      // Check for duplicates before approving
      const dupCheck = await checkPaymentDuplicate(tenantId, paymentId);
      if (dupCheck.hasDuplicate) {
        setDuplicateWarning(t('payments.duplicateWarning'));
        // Still allow approval but show warning
      }
      await approvePaymentTenant(tenantId, paymentId);
      await loadPayments();
      setApprovingId(null);
    } catch (err) {
      setError(t('payments.errorApproving'));
      setApprovingId(null);
    }
  };

  // Reject payment
  const handleReject = async () => {
    if (!tenantId || !rejectingId || !rejectReason) return;
    try {
      const finalReason = rejectReason === 'OTRO' ? rejectOtherReason : rejectReason;
      if (!finalReason.trim()) {
        setError(t('payments.specifyReason'));
        return;
      }
      await rejectPaymentTenant(tenantId, rejectingId, finalReason, rejectComment, rejectNotes);
      setRejectingId(null);
      setRejectReason('');
      setRejectComment('');
      setRejectNotes('');
      setRejectOtherReason('');
      await loadPayments();
    } catch (err) {
      setError(t('payments.errorRejecting'));
    }
  };

  // Initial load
  useEffect(() => {
    if (tenantId) {
      loadPayments();
      loadBuildings();
    }
  }, [tenantId]);

  // Handle filter change
  const handleFilterChange = (key: keyof PendingPaymentQuery, value: string) => {
    const newFilters = { ...filters };
    if (value === '' || value === undefined) {
      delete newFilters[key];
    } else {
      (newFilters as Record<string, string>)[key] = value;
    }
    setFilters(newFilters);
  };

  // Apply filters
  const handleApplyFilters = () => {
    loadPayments();
  };

  // Get status badge color
  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return 'bg-green-100 text-green-800';
      case 'REJECTED':
        return 'bg-red-100 text-red-800';
      case 'SUBMITTED':
        return 'bg-yellow-100 text-yellow-800';
      case 'RECONCILED':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Get status label in Spanish
  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      SUBMITTED: t('payments.submitted'),
      APPROVED: t('payments.approved'),
      REJECTED: t('payments.rejected'),
      RECONCILED: t('payments.reconciled'),
    };
    return labels[status] || status;
  };

  // Calculate age in days
  const getAgeDays = (createdAt: string) => {
    const created = new Date(createdAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - created.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // Calculate age in hours
  const getAgeHours = (createdAt: string) => {
    const created = new Date(createdAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - created.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60));
  };

  // Get SLA indicator class
  const getSlaClass = (createdAt: string) => {
    const hours = getAgeHours(createdAt);
    if (hours < 12) return 'text-green-600 bg-green-50 border-green-200';
    if (hours < 24) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  // Get SLA label
  const getSlaLabel = (createdAt: string) => {
    const hours = getAgeHours(createdAt);
    if (hours < 12) return t('payments.slaOk');
    if (hours < 24) return t('payments.slaWarning');
    return t('payments.slaOverdue');
  };

  if (!tenantId) {
    return <div className="text-sm text-muted-foreground">Sin tenant activo</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t('payments.title')}</h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleToggleMetrics}>
            {showMetrics ? t('payments.hideMetrics') : t('payments.showMetrics')}
          </Button>
          <span className="text-xs text-muted-foreground">
            {payments.length} {payments.length === 1 ? 'pago encontrado' : 'pagos encontrados'}
          </span>
        </div>
      </div>

      {/* Metrics Panel */}
      {showMetrics && metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">{t('payments.backlog')}</div>
            <div className="text-2xl font-bold">{metrics.backlogCount}</div>
            <div className="text-xs text-muted-foreground">{formatCurrency(metrics.backlogAmount, 'ARS')}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">{t('payments.age')}</div>
            <div className="text-2xl font-bold">{metrics.agingMedianDays} {t('payments.days')}</div>
            <div className="text-xs text-muted-foreground">P95: {metrics.agingP95Days} {t('payments.days')}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">{t('payments.approvalRate')}</div>
            <div className="text-2xl font-bold text-green-600">{metrics.approvalRate.toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground">{metrics.totalReviewed} {t('payments.reviewed')}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">{t('payments.rejectionRate')}</div>
            <div className="text-2xl font-bold text-red-600">{metrics.rejectionRate.toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground">
              {metrics.rejectionReasons.length > 0 
                ? `${t('payments.topReason')}: ${metrics.rejectionReasons[0].reason}`
                : '-'}
            </div>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-3 bg-gray-50 rounded-lg">
        <div className="flex-1 min-w-[150px]">
          <label className="text-xs text-muted-foreground mb-1 block">{t('payments.status')}</label>
          <Select
            value={filters.status || ''}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="w-full"
          >
            <option value="">{t('common.all')}</option>
            {PAYMENT_STATUSES.map((status) => (
              <option key={status} value={status}>{getStatusLabel(status)}</option>
            ))}
          </Select>
        </div>
        
          {/* Building Tabs - segmented pills */}
          {buildings.length > 0 && (
            <div className="mb-4">
              <div className="flex flex-wrap gap-2">
                {buildings
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedBuildingTab(b.id)}
                      className={`flex-1 items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition-all ${
                        selectedBuildingTab === b.id
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                          : 'bg-muted text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      }`}
                    >
                      {b.name}
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => setSelectedBuildingTab('all')}
                  className={`flex-1 items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition-all ${
                    selectedBuildingTab === 'all'
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-muted text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  Todos ({payments.length})
                </button>
              </div>
            </div>
          )}

        <div className="flex-1 min-w-[150px]">
          <label className="text-xs text-muted-foreground mb-1 block">{t('payments.unit')}</label>
          <Input
            placeholder={t('payments.unitPlaceholder')}
            value={filters.unitId || ''}
            onChange={(e) => handleFilterChange('unitId', e.target.value)}
          />
        </div>

        <div className="flex-1 min-w-[150px]">
          <label className="text-xs text-muted-foreground mb-1 block">{t('payments.dateFrom')}</label>
          <Input
            type="date"
            value={filters.dateFrom || ''}
            onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
          />
        </div>

        <div className="flex-1 min-w-[150px]">
          <label className="text-xs text-muted-foreground mb-1 block">{t('payments.dateTo')}</label>
          <Input
            type="date"
            value={filters.dateTo || ''}
            onChange={(e) => handleFilterChange('dateTo', e.target.value)}
          />
        </div>

        <div className="flex items-end">
          <Button onClick={handleApplyFilters} disabled={loading}>
            {loading ? t('payments.loadingData') : t('payments.applyFilters')}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Duplicate Warning */}
      {duplicateWarning && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm flex justify-between items-center">
          <span>{duplicateWarning}</span>
          <Button variant="ghost" size="sm" onClick={() => setDuplicateWarning(null)}>
            {t('common.close')}
          </Button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground">{t('payments.loading')}</div>
      ) : payments.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {t('payments.noPayments')}
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t('payments.unit')}</TH>
              <TH>{t('payments.building')}</TH>
              <TH>{t('payments.amount')}</TH>
              <TH>{t('payments.method')}</TH>
              <TH>{t('payments.reference')}</TH>
              <TH>{t('payments.status')}</TH>
              <TH>{t('payments.submittedBy')}</TH>
              <TH>{t('payments.age')}</TH>
              <TH>{t('payments.actions')}</TH>
            </TR>
          </THead>
          <TBody>
            {payments.map((p) => (
              <TR key={p.id}>
                <TD>{p.unit?.label || p.unitId || '-'}</TD>
                <TD>{p.building?.name || p.buildingId || '-'}</TD>
                <TD>{formatCurrency(p.amount, p.currency)}</TD>
                <TD>{p.method}</TD>
                <TD className="text-xs">{p.reference || '-'}</TD>
                <TD>
                  <Badge className={getStatusBadgeClass(p.status)}>
                    {getStatusLabel(p.status)}
                  </Badge>
                </TD>
                <TD className="text-xs">
                  {p.createdByUser?.name || p.createdByUser?.email || '-'}
                </TD>
                <TD>
                  <div className="flex flex-col gap-1">
                    <span className={`text-xs px-2 py-1 rounded border inline-block w-fit ${getSlaClass(p.createdAt)}`}>
                      {getSlaLabel(p.createdAt)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {getAgeDays(p.createdAt)} {t('payments.days')}
                    </span>
                  </div>
                </TD>
                <TD>
                  {canReview && p.status === 'SUBMITTED' ? (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        onClick={() => handleApprove(p.id)}
                        disabled={approvingId === p.id || loading}
                      >
                        {approvingId === p.id ? t('payments.approving') : t('payments.approve')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setRejectingId(p.id)}
                        disabled={approvingId === p.id || loading}
                      >
                        {t('payments.reject')}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">
                        {p.reviewedByMembership 
                          ? `${t('payments.reviewedBy')} ${p.reviewedByMembership.user.name}` 
                          : t('payments.noAction')}
                      </span>
                      {(p.status === 'APPROVED' || p.status === 'REJECTED') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleViewAudit(p.id)}
                        >
                          {t('payments.viewAudit')}
                        </Button>
                      )}
                    </div>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Rejection Modal */}
      {rejectingId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
            <h4 className="text-lg font-semibold mb-4">{t('payments.rejectionTitle')}</h4>
            
              <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">{t('payments.selectReason')}</label>
                <Select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full"
                >
                  <option value="">{t('common.select')}</option>
                  {REJECTION_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">{t('payments.rejectionComment')}</label>
                <textarea
                  className="w-full border rounded p-2 text-sm"
                  rows={2}
                  placeholder={t('payments.rejectionCommentPlaceholder')}
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                />
              </div>

              {rejectReason === 'OTRO' && (
                <div>
                  <label className="text-sm font-medium mb-2 block">{t('payments.specifyReason')}</label>
                  <textarea
                    className="w-full border rounded p-2 text-sm"
                    rows={3}
                    placeholder={t('payments.specifyReason')}
                    value={rejectOtherReason}
                    onChange={(e) => setRejectOtherReason(e.target.value)}
                  />
                </div>
              )}

              <div>
                <label className="text-sm font-medium mb-2 block">{t('payments.paymentNotes')}</label>
                <textarea
                  className="w-full border rounded p-2 text-sm"
                  rows={2}
                  placeholder={t('payments.paymentNotesPlaceholder')}
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="ghost"
                onClick={() => {
                  setRejectingId(null);
                  setRejectReason('');
                  setRejectComment('');
                  setRejectNotes('');
                  setRejectOtherReason('');
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={handleReject}
                disabled={!rejectReason}
              >
                {t('payments.confirmReject')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Audit History Modal */}
      {showAudit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-lg font-semibold">{t('payments.auditHistory')}</h4>
              <Button variant="ghost" size="sm" onClick={() => setShowAudit(false)}>
                {t('common.close')}
              </Button>
            </div>
            
            {loadingAudit ? (
              <div className="text-center py-4">{t('common.loading')}</div>
            ) : auditLogs.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">{t('payments.noAuditLogs')}</div>
            ) : (
              <div className="space-y-3">
                {auditLogs.map((log) => (
                  <div key={log.id} className="border rounded p-3 text-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className={`font-medium ${
                          log.action === 'APPROVED' ? 'text-green-600' : 
                          log.action === 'REJECTED' ? 'text-red-600' : 'text-gray-600'
                        }`}>
                          {log.action === 'APPROVED' ? t('payments.approved') : 
                           log.action === 'REJECTED' ? t('payments.rejected') : log.action}
                        </span>
                        {log.userName && (
                          <span className="text-muted-foreground"> - {log.userName}</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(new Date(log.createdAt))}
                      </span>
                    </div>
                    {log.reason && (
                      <div className="mt-1 text-muted-foreground">
                        <span className="font-medium">{t('payments.reason')}:</span> {log.reason}
                      </div>
                    )}
                    {log.comment && (
                      <div className="mt-1 text-muted-foreground">
                        <span className="font-medium">{t('payments.comment')}:</span> {log.comment}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentsReviewUI;
