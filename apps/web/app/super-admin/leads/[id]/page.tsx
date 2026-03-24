'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import Input from '@/shared/components/ui/Input';
import Textarea from '@/shared/components/ui/Textarea';
import Select from '@/shared/components/ui/Select';
import Badge from '@/shared/components/ui/Badge';
import { useLeads } from '@/features/super-admin/leads/useLeads';
import { t } from '@/i18n';
import { ErrorBoundary } from '@/shared/components/error-boundary';

const STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-800',
  CONTACTED: 'bg-purple-100 text-purple-800',
  QUALIFIED: 'bg-green-100 text-green-800',
  DISQUALIFIED: 'bg-red-100 text-red-800',
};

interface Lead {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  tenantType?: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  buildingsCount?: number;
  unitsEstimate?: number;
  message?: string;
  status: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  convertedTenantId?: string;
  convertedTenant?: {
    id: string;
    name: string;
    subscription?: Array<{
      plan?: { name: string };
      planId: string;
      status: string;
    }>;
  };
}

export default function LeadDetailPage() {
  const router = useRouter();
  const params = useParams();
  const leadId = params?.id as string;

  const { fetchLead, update, convert } = useLeads();

  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [successTenantId, setSuccessTenantId] = useState<string | null>(null);

  // Form state
  const [status, setStatus] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('');
  const [ownerEmail, setOwnerEmail] = useState<string>('');
  const [showConvertForm, setShowConvertForm] = useState(false);

  useEffect(() => {
    const loadLead = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchLead(leadId);
        if (data) {
          setLead(data);
          setStatus(data.status);
          setNotes(data.notes || '');
        } else {
          setError('Lead not found');
        }
      } catch (err) {
        setError('Failed to load lead');
      } finally {
        setLoading(false);
      }
    };

    if (leadId) {
      loadLead();
    }
  }, [leadId]);

  const handleUpdateLead = async () => {
    try {
      setIsSaving(true);
      setError(null);
      const updated = await update(leadId, {
        status: status as 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'DISQUALIFIED',
        notes,
      });
      if (updated) {
        setLead(updated);
        setSuccessMessage('Lead updated successfully');
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err) {
      setError('Failed to update lead');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConvertLead = async () => {
    if (!tenantName.trim()) {
      setError('Tenant name is required');
      return;
    }

    if (!ownerEmail.trim()) {
      setError('Owner email is required');
      return;
    }

    try {
      setIsConverting(true);
      setError(null);
      const result = await convert(leadId, {
        tenantName: tenantName.trim(),
        tenantType: lead?.tenantType,
        ownerEmail: ownerEmail.trim(),
      });
      if (result && result.tenantId) {
        setSuccessMessage('Lead converted successfully!');
        setSuccessTenantId(result.tenantId);
        setShowConvertForm(false);
        setTenantName('');
        setOwnerEmail('');
        // Refresh lead data
        const updated = await fetchLead(leadId);
        if (updated) {
          setLead(updated);
        }
        // Auto-hide success after 10 seconds
        setTimeout(() => {
          setSuccessMessage(null);
          setSuccessTenantId(null);
        }, 10000);
      } else {
        setError('Failed to convert lead: No tenant ID returned');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to convert lead';
      setError(message);
    } finally {
      setIsConverting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <p className="text-muted-foreground">Loading lead...</p>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="space-y-4">
        <Button onClick={() => router.back()}>← Back to Leads</Button>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-medium text-red-900">Lead Not Found</h3>
          <p className="text-sm text-red-700">The lead doesn't exist.</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary level="page">
      <div className="space-y-6">
        {/* Header */}
      <div>
        <Button onClick={() => router.back()} className="mb-4">
          ← {t('common.back')}
        </Button>
        <h1 className="text-3xl font-bold">{lead.fullName}</h1>
        <p className="text-muted-foreground mt-2">ID: {lead.id}</p>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-medium text-red-900">{t('common.error')}</h3>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-medium text-green-900">{t('common.success')}</h3>
          <p className="text-sm text-green-700">{successMessage}</p>
          {successTenantId && (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={() => router.push(`/super-admin/tenants/${successTenantId}`)}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                View Tenant →
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setSuccessMessage(null);
                  setSuccessTenantId(null);
                }}
              >
                Dismiss
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-6">
          {/* Basic Info */}
          <Card>
            <div className="p-6 border-b border-border">
              <h2 className="text-lg font-semibold">{t('superAdmin.leads.title')}</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t('common.name')}</p>
                  <p className="mt-1">{lead.fullName}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t('common.email')}</p>
                  <p className="mt-1">{lead.email}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t('common.phone')}</p>
                  <p className="mt-1">{lead.phone}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t('superAdmin.leads.tenantType')}</p>
                  <p className="mt-1">
                    <Badge>
                      {lead.tenantType === 'ADMINISTRADORA' ? 'Adm' : 'Auto'}
                    </Badge>
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t('superAdmin.leads.buildingsCount')}</p>
                  <p className="mt-1">{lead.buildingsCount || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t('superAdmin.leads.unitsEstimate')}</p>
                  <p className="mt-1">{lead.unitsEstimate || '-'}</p>
                </div>
              </div>

              {lead.message && (
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-muted-foreground">Message</p>
                  <p className="mt-2 text-sm whitespace-pre-wrap">{lead.message}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Status & Notes */}
          <Card>
            <div className="p-6 border-b border-border">
              <h2 className="text-lg font-semibold">{t('superAdmin.leads.status')} & {t('superAdmin.leads.notes')}</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium mb-2">{t('common.status')}</label>
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="NEW">{t('superAdmin.leads.statusNew')}</option>
                  <option value="CONTACTED">{t('superAdmin.leads.statusContacted')}</option>
                  <option value="QUALIFIED">{t('superAdmin.leads.statusQualified')}</option>
                  <option value="DISQUALIFIED">{t('superAdmin.leads.statusDisqualified')}</option>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-2">{t('superAdmin.leads.notes')}</label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('forms.placeholder')}
                  rows={4}
                />
              </div>

              <Button
                onClick={handleUpdateLead}
                disabled={isSaving}
                className="w-full"
              >
                {isSaving ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Metadata */}
          <Card>
            <div className="p-6 border-b border-border">
              <h2 className="text-lg font-semibold">{t('superAdmin.leads.view')}</h2>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t('common.createdAt')}</p>
                <p className="mt-1">
                  {new Date(lead.createdAt).toLocaleDateString('es-419')}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t('common.updatedAt')}</p>
                <p className="mt-1">
                  {new Date(lead.updatedAt).toLocaleDateString('es-419')}
                </p>
              </div>
              {lead.convertedTenant && (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Tenant Creado</p>
                    <p className="mt-1 font-semibold text-base">{lead.convertedTenant.name}</p>
                  </div>
                  {lead.convertedTenant.subscription && lead.convertedTenant.subscription[0] && (
                    <>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Plan</p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge className="bg-blue-100 text-blue-800">
                            {lead.convertedTenant.subscription[0].plan?.name || lead.convertedTenant.subscription[0].planId}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {lead.convertedTenant.subscription[0].status === 'TRIAL' && '(Trial)'}
                            {lead.convertedTenant.subscription[0].status === 'ACTIVE' && '(Activo)'}
                            {lead.convertedTenant.subscription[0].status === 'CANCELED' && '(Cancelado)'}
                          </span>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-border">
                        <Button
                          size="sm"
                          onClick={() => router.push(`/super-admin/tenants/${lead.convertedTenant!.id}`)}
                          className="w-full"
                        >
                          Ver Tenant →
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Convert */}
          {!lead.convertedTenantId ? (
            <Card className="border-amber-200">
              <div className="p-6 border-b border-amber-200">
                <h2 className="text-lg font-semibold">{t('superAdmin.leads.convertToCustomer')}</h2>
              </div>
              <div className="p-6 space-y-4">
                {!showConvertForm ? (
                  <Button
                    onClick={() => {
                      setShowConvertForm(true);
                      setOwnerEmail(lead?.email || '');
                    }}
                    className="w-full"
                  >
                    {t('superAdmin.leads.convertButton')}
                  </Button>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-medium mb-2">
                        {t('superAdmin.leads.tenantName')} *
                      </label>
                      <Input
                        value={tenantName}
                        onChange={(e) => setTenantName(e.target.value)}
                        placeholder={t('forms.placeholder')}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-2">
                        Email del Dueño *
                      </label>
                      <Input
                        type="email"
                        value={ownerEmail}
                        onChange={(e) => setOwnerEmail(e.target.value)}
                        placeholder="owner@example.com"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleConvertLead}
                        disabled={isConverting || !tenantName.trim() || !ownerEmail.trim()}
                        className="flex-1"
                      >
                        {isConverting ? t('superAdmin.leads.converting') : t('superAdmin.leads.convertButton')}
                      </Button>
                      <Button
                        onClick={() => {
                          setShowConvertForm(false);
                          setTenantName('');
                          setOwnerEmail('');
                        }}
                        className="flex-1"
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          ) : (
            lead.convertedTenant && (
              <Card className="border-green-200 bg-green-50">
                <div className="p-6 space-y-4">
                  <div>
                    <p className="text-sm font-medium text-green-700">✓ {t('superAdmin.leads.converted')}</p>
                  </div>

                  <div className="space-y-3 border-t border-green-200 pt-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Nombre del Tenant</p>
                      <p className="mt-1 font-semibold">{lead.convertedTenant.name}</p>
                    </div>

                    {lead.convertedTenant.subscription && lead.convertedTenant.subscription[0] && (
                      <>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Plan & Estado</p>
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center gap-2">
                              <Badge className="bg-blue-100 text-blue-800">
                                {lead.convertedTenant.subscription[0].plan?.name || lead.convertedTenant.subscription[0].planId}
                              </Badge>
                              <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                                {lead.convertedTenant.subscription[0].status === 'TRIAL' && 'Trial (14 días)'}
                                {lead.convertedTenant.subscription[0].status === 'ACTIVE' && 'Activo'}
                                {lead.convertedTenant.subscription[0].status === 'CANCELED' && 'Cancelado'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        onClick={() => router.push(`/super-admin/tenants/${lead.convertedTenant!.id}`)}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                      >
                        Ver Tenant
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          // Copy tenant ID to clipboard for support
                          navigator.clipboard.writeText(lead.convertedTenant!.id);
                          setSuccessMessage('Tenant ID copied to clipboard');
                          setTimeout(() => setSuccessMessage(null), 2000);
                        }}
                        className="flex-1"
                      >
                        Copiar ID
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            )
          )}
        </div>
      </div>
      </div>
    </ErrorBoundary>
  );
}
