'use client';

import { useParams, useRouter } from 'next/navigation';
import { Table, THead, TR, TH, TBody, TD } from '../../shared/components/ui/Table';
import Button from '../../shared/components/ui/Button';
import EmptyState from '../../shared/components/ui/EmptyState';
import ErrorState from '../../shared/components/ui/ErrorState';
import { useBuildings } from '../buildings/hooks';
import { useCan } from '../rbac/rbac.hooks';
import { Building2, Plus } from 'lucide-react';
import Link from 'next/link';
import { routes } from '@/shared/lib/routes';
import { t } from '@/i18n';

type TenantParams = {
  tenantId: string;
};

export default function PropertiesUI() {
  const params = useParams<TenantParams>();
  const router = useRouter();
  const tenantId = params?.tenantId;
  const canWrite = useCan('properties.write');

  const { buildings, loading, error, refetch } = useBuildings(tenantId);

  if (!tenantId) {
    return <div>{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t('buildings.title')}</h3>
        {canWrite && (
          <Link href={routes.buildingsList(tenantId)}>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              {t('buildings.create')}
            </Button>
          </Link>
        )}
      </div>

      {/* Error State */}
      {error && (
        <ErrorState
          message={error}
          onRetry={() => refetch()}
        />
      )}

      {/* Loading State */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted animate-pulse rounded" />
          ))}
        </div>
      ) : buildings.length === 0 ? (
        /* Empty State */
        <EmptyState
          icon={<Building2 className="w-12 h-12 text-muted-foreground" />}
          title={t('emptyStates.noBuildings')}
          description={t('emptyStates.startCreating')}
          cta={{
            text: t('buildings.create'),
            onClick: () => router.push(routes.buildingsList(tenantId)),
          }}
        />
      ) : (
        /* Buildings Table */
        <Table>
          <THead>
            <TR>
              <TH>{t('buildings.name')}</TH>
              <TH>{t('buildings.address')}</TH>
              <TH>{t('common.actions')}</TH>
            </TR>
          </THead>
          <TBody>
            {buildings.map((building) => (
              <TR key={building.id}>
                <TD>{building.name}</TD>
                <TD>{building.address || '-'}</TD>
                <TD>
                  <Link href={routes.buildingOverview(tenantId, building.id)}>
                    <Button variant="secondary" size="sm">
                      {t('common.view')}
                    </Button>
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
