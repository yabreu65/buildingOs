'use client';

import { useMemo, useState } from 'react';
import { CalendarClock, Loader2, Plus, RefreshCw } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { formatCurrency } from '@/shared/lib/format/money';
import { useBuildings } from '@/features/buildings/hooks';
import {
  useExpenseLedgerCategories,
  useTenantRecurringExpenses,
  useCreateTenantRecurringExpense,
  useUpdateTenantRecurringExpense,
} from '../hooks/useExpenseLedger';
import type {
  CreateTenantRecurringExpenseData,
  RecurringExpense,
  RecurringExpenseAllocationMode,
} from '../services/expense-ledger.api';
import { TenantRecurringExpenseModal } from './TenantRecurringExpenseModal';

interface TenantRecurringExpensesTabProps {
  tenantId: string;
}

function frequencyLabel(frequency: string): string {
  const labels: Record<string, string> = {
    MONTHLY: 'Mensual',
    QUARTERLY: 'Trimestral',
    YEARLY: 'Anual',
  };
  return labels[frequency] ?? frequency;
}

function allocationModeLabel(mode: RecurringExpenseAllocationMode | null): string {
  const labels: Record<RecurringExpenseAllocationMode, string> = {
    MANUAL: 'Distribución manual',
    EQUAL_SHARE: 'Partes iguales',
    BUILDING_TOTAL_M2: 'Según m² de los edificios',
  };
  return mode ? labels[mode] : 'Sin especificar';
}

function formatDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString('es-AR');
}

export function TenantRecurringExpensesTab({ tenantId }: TenantRecurringExpensesTabProps) {
  const { toast } = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<RecurringExpense | null>(null);

  const { buildings } = useBuildings(tenantId);

  const {
    data: recurringExpenses = [],
    isPending,
    error,
    refetch,
  } = useTenantRecurringExpenses(tenantId);

  const { data: categories = [] } = useExpenseLedgerCategories(
    tenantId,
    'EXPENSE',
    'CONDOMINIUM_COMMON',
  );

  const createMutation = useCreateTenantRecurringExpense(tenantId);
  const updateMutation = useUpdateTenantRecurringExpense(tenantId);

  const categoryOptions = useMemo(
    () => categories.map((category) => ({ id: category.id, name: category.name })),
    [categories],
  );

  const handleCreate = async (data: CreateTenantRecurringExpenseData) => {
    try {
      await createMutation.mutateAsync(data);
      toast('Regla recurrente creada', 'success');
      setShowCreateModal(false);
    } catch {
      toast('Error al crear regla recurrente', 'error');
    }
  };

  const handleEdit = async (data: CreateTenantRecurringExpenseData) => {
    if (!editingExpense) {
      return;
    }

    try {
      await updateMutation.mutateAsync({
        recurringExpenseId: editingExpense.id,
        data: {
          amount: data.amount,
          concept: data.concept,
        },
      });
      toast('Regla recurrente actualizada', 'success');
      setEditingExpense(null);
    } catch {
      toast('Error al actualizar regla recurrente', 'error');
    }
  };

  const handleToggleActive = async (item: RecurringExpense) => {
    try {
      await updateMutation.mutateAsync({
        recurringExpenseId: item.id,
        data: { isActive: !item.isActive },
      });
      toast(item.isActive ? 'Regla desactivada' : 'Regla activada', 'success');
    } catch {
      toast('Error al cambiar estado', 'error');
    }
  };

  const isLoadingAction = createMutation.isPending || updateMutation.isPending;

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Reglas recurrentes comunes</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Plantillas de gastos comunes que el cron convierte en gastos DRAFT automáticamente.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refetch()}
            disabled={isLoadingAction}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refrescar
          </Button>
          <Button size="sm" onClick={() => setShowCreateModal(true)} disabled={isLoadingAction}>
            <Plus className="h-4 w-4 mr-1" />
            Nueva regla
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-red-200 bg-red-50 p-4 text-red-700">
          Error al cargar reglas recurrentes.
        </Card>
      ) : recurringExpenses.length === 0 ? (
        <Card className="border-dashed p-8 text-center text-muted-foreground">
          <CalendarClock className="mx-auto mb-2 h-8 w-8" />
          No hay reglas recurrentes comunes configuradas.
        </Card>
      ) : (
        <div className="space-y-3">
          {recurringExpenses.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{item.concept}</p>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {item.isActive ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{allocationModeLabel(item.allocationMode)}</span>
                    <span>•</span>
                    <span>{frequencyLabel(item.frequency)}</span>
                    <span>•</span>
                    <span>{formatCurrency(item.amount, item.currency)}</span>
                    <span>•</span>
                    <span>Siguiente ejecución: {formatDate(item.nextRunDate)}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditingExpense(item)}
                    disabled={isLoadingAction}
                  >
                    Editar
                  </Button>
                  <Button
                    variant={item.isActive ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => void handleToggleActive(item)}
                    disabled={isLoadingAction}
                  >
                    {item.isActive ? 'Desactivar' : 'Activar'}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreateModal && (
        <TenantRecurringExpenseModal
          isOpen={showCreateModal}
          categoryOptions={categoryOptions}
          buildings={buildings}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreate}
          isSubmitting={createMutation.isPending}
        />
      )}

      {editingExpense && (
        <TenantRecurringExpenseModal
          isOpen={!!editingExpense}
          initialValue={editingExpense}
          categoryOptions={categoryOptions}
          buildings={buildings}
          onClose={() => setEditingExpense(null)}
          onSubmit={handleEdit}
          isSubmitting={updateMutation.isPending}
        />
      )}
    </div>
  );
}
