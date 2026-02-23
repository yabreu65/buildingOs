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

const STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-800',
  CONTACTED: 'bg-purple-100 text-purple-800',
  QUALIFIED: 'bg-green-100 text-green-800',
  DISQUALIFIED: 'bg-red-100 text-red-800',
};

export default function LeadDetailPage() {
  const router = useRouter();
  const params = useParams();
  const leadId = params?.id as string;

  const { fetchLead, update, convert } = useLeads();

  const [lead, setLead] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state
  const [status, setStatus] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('');
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
  }, [leadId, fetchLead]);

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

    try {
      setIsConverting(true);
      setError(null);
      const result = await convert(leadId, {
        tenantName: tenantName.trim(),
        tenantType: lead?.tenantType,
      });
      if (result) {
        setSuccessMessage(`Lead converted! Tenant ID: ${result.tenantId}`);
        setShowConvertForm(false);
        setTenantName('');
        const updated = await fetchLead(leadId);
        if (updated) {
          setLead(updated);
        }
      }
    } catch (err) {
      setError('Failed to convert lead');
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Button onClick={() => router.back()} className="mb-4">
          ← Back
        </Button>
        <h1 className="text-3xl font-bold">{lead.fullName}</h1>
        <p className="text-muted-foreground mt-2">ID: {lead.id}</p>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-medium text-red-900">Error</h3>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-medium text-green-900">Success</h3>
          <p className="text-sm text-green-700">{successMessage}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-6">
          {/* Basic Info */}
          <Card>
            <div className="p-6 border-b border-border">
              <h2 className="text-lg font-semibold">Lead Information</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Name</p>
                  <p className="mt-1">{lead.fullName}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Email</p>
                  <p className="mt-1">{lead.email}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Phone</p>
                  <p className="mt-1">{lead.phone}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Type</p>
                  <p className="mt-1">
                    <Badge>
                      {lead.tenantType === 'ADMINISTRADORA' ? 'Adm' : 'Auto'}
                    </Badge>
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Buildings</p>
                  <p className="mt-1">{lead.buildingsCount || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Units Est.</p>
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
              <h2 className="text-lg font-semibold">Status & Notes</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium mb-2">Status</label>
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="NEW">New</option>
                  <option value="CONTACTED">Contacted</option>
                  <option value="QUALIFIED">Qualified</option>
                  <option value="DISQUALIFIED">Disqualified</option>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-2">Notes</label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes..."
                  rows={4}
                />
              </div>

              <Button
                onClick={handleUpdateLead}
                disabled={isSaving}
                className="w-full"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Metadata */}
          <Card>
            <div className="p-6 border-b border-border">
              <h2 className="text-lg font-semibold">Details</h2>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Created</p>
                <p className="mt-1">
                  {new Date(lead.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Updated</p>
                <p className="mt-1">
                  {new Date(lead.updatedAt).toLocaleDateString()}
                </p>
              </div>
              {lead.convertedTenantId && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Tenant ID</p>
                  <p className="mt-1 font-mono text-xs">{lead.convertedTenantId}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Convert */}
          {!lead.convertedTenantId ? (
            <Card className="border-amber-200">
              <div className="p-6 border-b border-amber-200">
                <h2 className="text-lg font-semibold">Convert Lead</h2>
              </div>
              <div className="p-6 space-y-4">
                {!showConvertForm ? (
                  <Button
                    onClick={() => setShowConvertForm(true)}
                    className="w-full"
                  >
                    Start Conversion
                  </Button>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-medium mb-2">
                        Tenant Name *
                      </label>
                      <Input
                        value={tenantName}
                        onChange={(e) => setTenantName(e.target.value)}
                        placeholder="e.g., Acme Corp"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleConvertLead}
                        disabled={isConverting || !tenantName.trim()}
                        className="flex-1"
                      >
                        {isConverting ? 'Converting...' : 'Convert'}
                      </Button>
                      <Button
                        onClick={() => {
                          setShowConvertForm(false);
                          setTenantName('');
                        }}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          ) : (
            <Card className="border-green-200">
              <div className="p-6">
                <p className="text-sm text-green-700">✓ Converted to customer</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
