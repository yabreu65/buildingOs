'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import Button from '@/shared/components/ui/Button';
import Input from '@/shared/components/ui/Input';
import Select from '@/shared/components/ui/Select';
import Badge from '@/shared/components/ui/Badge';
import Card from '@/shared/components/ui/Card';
import { useLeads } from '@/features/super-admin/leads/useLeads';
import { t } from '@/i18n';

const STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-800',
  CONTACTED: 'bg-purple-100 text-purple-800',
  QUALIFIED: 'bg-green-100 text-green-800',
  DISQUALIFIED: 'bg-red-100 text-red-800',
};

export default function LeadsPage() {
  const {
    leads,
    total,
    page,
    loading,
    error,
    filters,
    fetchLeads,
    pageSize,
  } = useLeads();

  const [statusFilter, setStatusFilter] = useState<string>('');
  const [emailFilter, setEmailFilter] = useState<string>('');

  const handleFilterChange = async () => {
    await fetchLeads(
      {
        status: statusFilter || undefined,
        email: emailFilter || undefined,
      },
      0
    );
  };

  const handleNextPage = async () => {
    await fetchLeads(filters, page + 1);
  };

  const handlePrevPage = async () => {
    if (page > 0) {
      await fetchLeads(filters, page - 1);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">{t('superAdmin.leads.title')}</h1>
        <p className="text-muted-foreground mt-2">
          {t('superAdmin.leads.list')}
        </p>
      </div>

      {/* Filters */}
      <Card>
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-semibold">{t('common.filter')}</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">{t('common.status')}</label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">{t('forms.selectStatus')}</option>
                <option value="NEW">{t('superAdmin.leads.statusNew')}</option>
                <option value="CONTACTED">{t('superAdmin.leads.statusContacted')}</option>
                <option value="QUALIFIED">{t('superAdmin.leads.statusQualified')}</option>
                <option value="DISQUALIFIED">{t('superAdmin.leads.statusDisqualified')}</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">{t('common.email')}</label>
              <Input
                placeholder={t('forms.placeholder')}
                value={emailFilter}
                onChange={(e) => setEmailFilter(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleFilterChange} className="w-full">
                {t('common.apply')}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-medium text-red-900">{t('common.error')}</h3>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <p className="text-muted-foreground">{t('common.loading')}</p>
        </div>
      )}

      {/* Leads Table */}
      {!loading && leads.length === 0 && (
        <div className="text-center py-12 bg-muted rounded-lg">
          <p className="text-muted-foreground">{t('emptyStates.noLeads')}</p>
        </div>
      )}

      {!loading && leads.length > 0 && (
        <Card>
          <div className="p-6 border-b border-border">
            <h2 className="text-lg font-semibold">
              {t('superAdmin.leads.title')} ({page * pageSize + 1} - {Math.min((page + 1) * pageSize, total)} de {total})
            </h2>
          </div>
          <div className="p-6 overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>{t('common.createdAt')}</TH>
                  <TH>{t('common.name')}</TH>
                  <TH>{t('common.email')}</TH>
                  <TH>{t('common.phone')}</TH>
                  <TH>{t('superAdmin.leads.tenantType')}</TH>
                  <TH>{t('superAdmin.leads.unitsEstimate')}</TH>
                  <TH>{t('common.status')}</TH>
                  <TH className="text-right">{t('common.actions')}</TH>
                </TR>
              </THead>
              <TBody>
                {leads.map((lead) => (
                  <TR key={lead.id}>
                    <TD className="text-sm text-muted-foreground">
                      {new Date(lead.createdAt).toLocaleDateString()}
                    </TD>
                    <TD className="font-medium">{lead.fullName}</TD>
                    <TD className="text-sm">{lead.email}</TD>
                    <TD className="text-sm">{lead.phone}</TD>
                    <TD>
                      <Badge>
                        {lead.tenantType === 'ADMINISTRADORA'
                          ? 'Adm'
                          : 'Auto'}
                      </Badge>
                    </TD>
                    <TD className="text-sm">{lead.unitsEstimate || '-'}</TD>
                    <TD>
                      <Badge className={STATUS_COLORS[lead.status]}>
                        {t(`superAdmin.leads.status${lead.status}`)}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <Link href={`/super-admin/leads/${lead.id}`}>
                        <Button>{t('common.view')}</Button>
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {/* Pagination */}
            <div className="flex justify-between items-center mt-6">
              <p className="text-sm text-muted-foreground">
                Página {page + 1} de {Math.ceil(total / pageSize)}
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={handlePrevPage}
                  disabled={page === 0 || loading}
                >
                  {t('forms.previousStep')}
                </Button>
                <Button
                  onClick={handleNextPage}
                  disabled={(page + 1) * pageSize >= total || loading}
                >
                  {t('forms.nextStep')}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
