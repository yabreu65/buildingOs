'use client';

import { useMemo, useState } from 'react';
import { CalendarClock, Loader2, Plus, RefreshCw } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { formatCurrency } from '@/shared/lib/format/money';
import {
  useExpenseLedgerCategories,
  useRecurringExpenses,
  useCreateRecurringExpense,
  useUpdateRecurringExpense,
} from '../hooks/useExpenseLedger';
import type { RecurringExpense } from '../services/expense-ledger.api';
import { RecurringExpenseModal } from './RecurringExpenseModal';

interface RecurringExpensesTabProps {
  tenantId: string;
  buildingId: string;
}

function frequencyLabel(frequency: string): string {
  const labels: Record<string, string> = {
    MONTHLY: 'Mensual',
    QUARTERLY: 'Trimestral',
    YEARLY: 'Anual',
  };
  return labels[frequency] ?? frequency;
}

function formatDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString('es-AR');
}

export function RecurringExpensesTab({ tenantId, buildingId }: RecurringExpensesTabProps) {
  const { toast } = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<RecurringExpense | null>(null);

  const {
    data: recurringExpenses = [],
    isPending,
    error,
    refetch,
  } = useRecurringExpenses(buildingId);

  const { data: categories = [] } = useExpenseLedgerCategories(
    tenantId,
    'EXPENSE',
    'BUILDING',
  );

  const createMutation = useCreateRecurringExpense(buildingId);
  const updateMutation = useUpdateRecurringExpense(buildingId);

  const categoryOptions = useMemo(
    () => categories.map((category) => ({ id: category.id, name: category.name })),
    [categories],
  );

  const handleCreate = async (data: {
    categoryId: string;
    amount: number;
    currency: string;
    concept: string;
    frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  }) => {
    try {
      await createMutation.mutateAsync(data);
      toast('Gasto recurrente creado', 'success');
      setShowCreateModal(false);
    } catch {
      toast('Error al crear gasto recurrente', 'error');
    }
  };

  const handleEdit = async (data: {
    categoryId: string;
    amount: number;
    currency: string;
    concept: string;
    frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  }) => {
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
      toast('Gasto recurrente actualizado', 'success');
      setEditingExpense(null);
    } catch {
      toast('Error al actualizar gasto recurrente', 'error');
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
          <h3 className="text-sm font-medium text-muted-foreground">Gastos recurrentes</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configura plantillas que el cron diario convierte en gastos DRAFT automaticamente.
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
            Nuevo recurrente
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-red-200 bg-red-50 p-4 text-red-700">
          Error al cargar gastos recurrentes.
        </Card>
      ) : recurringExpenses.length === 0 ? (
        <Card className="border-dashed p-8 text-center text-muted-foreground">
          <CalendarClock className="mx-auto mb-2 h-8 w-8" />
          No hay reglas recurrentes configuradas.
        </Card>
      ) : (
        <div className="space-y-3">
          {recurringExpenses.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <p className="font-medium">{item.concept}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{frequencyLabel(item.frequency)}</span>
                    <span>•</span>
                    <span>{formatCurrency(item.amount, item.currency)}</span>
                    <span>•</span>
                    <span>Siguiente ejecucion: {formatDate(item.nextRunDate)}</span>
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

      <RecurringExpenseModal
        isOpen={showCreateModal}
        categoryOptions={categoryOptions}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreate}
        isSubmitting={createMutation.isPending}
      />

      <RecurringExpenseModal
        isOpen={!!editingExpense}
        initialValue={editingExpense || undefined}
        categoryOptions={categoryOptions}
        onClose={() => setEditingExpense(null)}
        onSubmit={handleEdit}
        isSubmitting={updateMutation.isPending}
      />
    </div>
  );
}
