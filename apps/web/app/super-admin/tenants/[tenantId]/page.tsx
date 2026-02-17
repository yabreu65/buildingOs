'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import SubscriptionPanel from '@/features/billing/components/SubscriptionPanel';
import { getTenantById } from '@/features/super-admin/tenants.storage';
import { useBoStorageTick } from '@/shared/lib/storage/useBoStorage';
import { ChevronLeft } from 'lucide-react';
import type { Tenant } from '@/features/super-admin/super-admin.types';

interface TenantDetailPageProps {
  params: {
    tenantId: string;
  };
}

export default function TenantDetailPage({
  params,
}: TenantDetailPageProps) {
  useBoStorageTick();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    try {
      const loaded = getTenantById(params.tenantId);
      setTenant(loaded || null);
    } catch (error) {
      console.error('Failed to load tenant:', error);
      setTenant(null);
    } finally {
      setLoading(false);
    }
  }, [params.tenantId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted rounded w-32 animate-pulse" />
        <div className="h-32 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="space-y-4">
        <Link href="/super-admin/tenants">
          <Button variant="secondary" size="sm">
            <ChevronLeft className="w-4 h-4 mr-2" />
            Back to Tenants
          </Button>
        </Link>
        <Card>
          <div className="text-center py-12">
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Tenant Not Found
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Could not find tenant with ID: {params.tenantId}
            </p>
            <Link href="/super-admin/tenants">
              <Button size="sm">Go Back to Tenants</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/super-admin/tenants">
          <Button variant="secondary" size="sm">
            <ChevronLeft className="w-4 h-4 mr-2" />
            Back to Tenants
          </Button>
        </Link>
        <h1 className="text-3xl font-bold text-foreground mt-4">
          {tenant.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          ID: {tenant.id}
        </p>
      </div>

      {/* Tenant Info */}
      <Card>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Tenant Information
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Name
            </div>
            <div className="text-sm font-medium text-foreground mt-1">
              {tenant.name}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Status
            </div>
            <div className="text-sm font-medium text-foreground mt-1">
              <span
                className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                  tenant.status === 'ACTIVE'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {tenant.status}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Created
            </div>
            <div className="text-sm font-medium text-foreground mt-1">
              {new Date(tenant.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      </Card>

      {/* Subscription Management */}
      <SubscriptionPanel tenantId={params.tenantId} />
    </div>
  );
}
