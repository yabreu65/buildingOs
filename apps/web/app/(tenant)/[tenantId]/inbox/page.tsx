'use client';

import React, { useState } from 'react';
import { useAuth } from '@/features/auth/useAuth';
import { useContextManager } from '@/features/context/useContext';
import { useInboxSummary } from '@/features/inbox/useInboxSummary';
import { ContextSelector } from '@/features/context/components/ContextSelector';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Skeleton from '@/shared/components/ui/Skeleton';
import ErrorState from '@/shared/components/ui/ErrorState';
import EmptyState from '@/shared/components/ui/EmptyState';
import Badge from '@/shared/components/ui/Badge';
import { useAiNudges } from '@/features/assistant/hooks/useAiNudges';
import { AiNudgesPanel } from '@/features/assistant/components/limits/AiNudgesPanel';

interface InboxPageProps {
  params: {
    tenantId: string;
  };
}

export default function InboxPage({ params }: InboxPageProps) {
  const { tenantId } = params;
  const { status, session } = useAuth();
  const { context, options } = useContextManager(tenantId);
  const { summary, loading, error, refetch } = useInboxSummary(
    tenantId,
    context?.activeBuildingId,
    20,
  );

  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(
    context?.activeBuildingId || null,
  );
  const {
    nudges,
    loading: nudgesLoading,
    submitting: nudgesSubmitting,
    dismiss,
    requestUpgrade,
  } = useAiNudges(tenantId);

  if (status === 'loading') {
    return <div className="p-6">Carregando...</div>;
  }

  if (status === 'unauthenticated' || !session) {
    return <div className="p-6 text-red-600">Acesso negado</div>;
  }

  const handleBuildingChange = async (buildingId: string | null) => {
    setSelectedBuildingId(buildingId);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold">Bandeja Unificada</h1>
          <p className="text-gray-600 mt-1">
            Pendências e atividades cross-building
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          {options && (
            <ContextSelector
              tenantId={tenantId}
              context={context}
              options={options.buildings}
              unitsByBuilding={options.unitsByBuilding}
              onBuildingChange={async (bid) => {
                handleBuildingChange(bid);
                await refetch();
              }}
              onUnitChange={async () => {
                await refetch();
              }}
              isLoading={loading}
            />
          )}
          <Button onClick={() => refetch()} disabled={loading}>
            {loading ? '⟳ Atualizando...' : '⟳ Atualizar'}
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <ErrorState
          message={error}
          onRetry={refetch}
        />
      )}

      <AiNudgesPanel
        nudges={nudges}
        loading={nudgesLoading}
        submitting={nudgesSubmitting}
        onDismiss={dismiss}
        onRequestUpgrade={requestUpgrade}
      />

      {/* Loading state */}
      {loading && !summary ? (
        <div className="grid gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <Skeleton className="h-32 rounded" />
            </Card>
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-6">
          {/* Tickets Section */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Tickets Pendentes</h2>
              <Badge>{summary.tickets.length}</Badge>
            </div>

            {summary.tickets.length === 0 ? (
              <EmptyState
                title="Nenhum ticket pendente"
                description="Todos os tickets estão resolvidos"
              />
            ) : (
              <div className="space-y-2">
                {summary.tickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="p-3 border rounded hover:bg-gray-50 cursor-pointer transition"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {ticket.title}
                          </span>
                          <Badge className="bg-blue-100 text-blue-700">
                            {ticket.buildingName}
                          </Badge>
                          {ticket.unitCode && (
                            <Badge >{ticket.unitCode}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Criado{' '}
                          {new Date(ticket.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge
                          className={
                            ticket.priority === 'URGENT'
                              ? 'bg-red-100 text-red-700'
                              : ticket.priority === 'HIGH'
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-gray-100 text-gray-700'
                          }
                        >
                          {ticket.priority}
                        </Badge>
                        <p className="text-xs text-gray-500 mt-1">
                          {ticket.status}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Payments Section */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Pagamentos Pendentes</h2>
              <Badge>{summary.payments.length}</Badge>
            </div>

            {summary.payments.length === 0 ? (
              <EmptyState
                title="Nenhum pagamento pendente"
                description="Todos os pagamentos foram revisados"
              />
            ) : (
              <div className="space-y-2">
                {summary.payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="p-3 border rounded hover:bg-gray-50 cursor-pointer transition"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-blue-100 text-blue-700">
                            {payment.buildingName}
                          </Badge>
                          {payment.unitCode && (
                            <Badge >{payment.unitCode}</Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium mt-1">
                          {(payment.amount / 100).toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          })}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {payment.method} •{' '}
                          {new Date(payment.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Communications Section */}
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Comunicações em Rascunho</h2>
              <Badge>{summary.communications.length}</Badge>
            </div>

            {summary.communications.length === 0 ? (
              <EmptyState
                title="Nenhuma comunicação em rascunho"
                description="Todos os rascunhos foram publicados"
              />
            ) : (
              <div className="space-y-2">
                {summary.communications.map((comm) => (
                  <div
                    key={comm.id}
                    className="p-3 border rounded hover:bg-gray-50 cursor-pointer transition"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {comm.title}
                          </span>
                          {comm.buildingName && (
                            <Badge className="bg-blue-100 text-blue-700">
                              {comm.buildingName}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {comm.channel} •{' '}
                          {new Date(comm.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge
                        className={
                          comm.status === 'SCHEDULED'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-700'
                        }
                      >
                        {comm.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Alerts Section */}
          <Card>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Alertas Rápidos</h2>
            </div>

            {summary.alerts.urgentUnassignedTicketsCount === 0 &&
            summary.alerts.delinquentUnitsTop.length === 0 ? (
              <EmptyState
                title="Nenhum alerta"
                description="Tudo está sob controle"
              />
            ) : (
              <div className="space-y-4">
                {/* Urgent Unassigned Tickets Alert */}
                {summary.alerts.urgentUnassignedTicketsCount > 0 && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded">
                    <div className="flex items-start gap-3">
                      <div className="text-2xl">⚠️</div>
                      <div>
                        <p className="font-medium text-red-900">
                          {summary.alerts.urgentUnassignedTicketsCount} Tickets
                          Urgentes Sem Atribuição
                        </p>
                        <p className="text-sm text-red-700 mt-1">
                          Há tickets com prioridade alta ou urgente que ainda
                          não foram atribuídos.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Delinquent Units Alert */}
                {summary.alerts.delinquentUnitsTop.length > 0 && (
                  <div className="p-4 bg-orange-50 border border-orange-200 rounded">
                    <div className="flex items-start gap-3">
                      <div className="text-2xl">💰</div>
                      <div className="flex-1">
                        <p className="font-medium text-orange-900">
                          Unidades em Atraso
                        </p>
                        <div className="mt-2 space-y-1">
                          {summary.alerts.delinquentUnitsTop.map((unit) => (
                            <div key={unit.unitId} className="text-sm">
                              <span className="font-medium text-orange-700">
                                {unit.buildingName} - {unit.unitCode}:
                              </span>
                              <span className="text-orange-600 ml-2">
                                {(unit.outstanding / 100).toLocaleString(
                                  'pt-BR',
                                  {
                                    style: 'currency',
                                    currency: 'BRL',
                                  },
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
