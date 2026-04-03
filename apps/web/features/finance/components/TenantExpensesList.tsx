'use client';

import { useState } from 'react';
import { Plus, CheckCircle, XCircle, Loader2, Pencil } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatCurrency } from '@/shared/lib/format/money';
import { useToast } from '@/shared/components/ui/Toast';
import Button from '@/shared/components/ui/Button';
import { Expense, ExpenseStatus } from '../services/expense-ledger.api';
import {
  useValidateExpense,
  useVoidExpense,
} from '../hooks/useExpenseLedger';
import { ExpenseCreateModal } from './ExpenseCreateModal';

interface TenantExpensesListProps {
  tenantId: string;
  period: string;
  expenses: Expense[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const STATUS_LABELS: Record<ExpenseStatus, string> = {
  DRAFT: 'Borrador',
  VALIDATED: 'Validado',
  VOID: 'Anulado',
};

const STATUS_COLORS: Record<ExpenseStatus, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  VALIDATED: 'bg-green-100 text-green-800',
  VOID: 'bg-gray-100 text-gray-500 line-through',
};

export function TenantExpensesList({
  tenantId,
  period,
  expenses,
  loading,
  error,
  onRefresh,
}: TenantExpensesListProps) {
  const { toast } = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const validateMutation = useValidateExpense(tenantId);
  const voidMutation = useVoidExpense(tenantId);

  const handleValidate = async (expenseId: string) => {
    setActioningId(expenseId);
    try {
      await validateMutation.mutateAsync(expenseId);
      toast('Gasto validado correctamente', 'success');
    } catch {
      toast('Error al validar el gasto', 'error');
    } finally {
      setActioningId(null);
    }
  };

  const handleVoid = async (expenseId: string) => {
    setActioningId(expenseId);
    try {
      await voidMutation.mutateAsync(expenseId);
      toast('Gasto anulado', 'success');
    } catch {
      toast('Error al anular el gasto', 'error');
    } finally {
      setActioningId(null);
    }
  };

  const totalsByCurrency: Record<string, number> = {};
  for (const e of expenses) {
    if (e.status === 'VALIDATED') {
      totalsByCurrency[e.currencyCode] =
        (totalsByCurrency[e.currencyCode] ?? 0) + e.amountMinor;
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">
            Gastos comunes del período {period}
          </h3>
          {Object.entries(totalsByCurrency).length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Total validado:{' '}
              {Object.entries(totalsByCurrency)
                .map(([cur, amt]) => formatCurrency(amt, cur))
                .join(' + ')}
            </p>
          )}
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowCreateModal(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          Nuevo gasto común
        </Button>
      </div>

      {/* Table */}
      {expenses.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No hay gastos comunes registrados para este período.
          <br />
          <span className="text-xs">
            Los gastos comunes del conjunto se prorratean entre los edificios.
          </span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Rubro</th>
                <th className="px-4 py-3 text-left font-medium">Proveedor</th>
                <th className="px-4 py-3 text-left font-medium">Fecha</th>
                <th className="px-4 py-3 text-right font-medium">Monto</th>
                <th className="px-4 py-3 text-center font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {expenses.map((expense) => (
                <tr key={expense.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <span className="font-medium">{expense.categoryName}</span>
                    {expense.description && (
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {expense.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {expense.vendorName ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {(() => {
                      const dateStr = expense.invoiceDate;
                      if (!dateStr) return '—';
                      const d = new Date(dateStr);
                      return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('es-AR', { timeZone: 'UTC' });
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(expense.amountMinor, expense.currencyCode)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={cn(
                        'inline-block px-2 py-0.5 rounded-full text-xs font-medium',
                        STATUS_COLORS[expense.status],
                      )}
                    >
                      {STATUS_LABELS[expense.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {expense.status === 'DRAFT' && (
                        <>
                          <button
                            onClick={() => setEditingExpense(expense)}
                            disabled={actioningId === expense.id}
                            title="Editar"
                            className="p-1.5 rounded hover:bg-blue-100 text-blue-700 disabled:opacity-50"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleValidate(expense.id)}
                            disabled={actioningId === expense.id}
                            title="Validar"
                            className="p-1.5 rounded hover:bg-green-100 text-green-700 disabled:opacity-50"
                          >
                            {actioningId === expense.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleVoid(expense.id)}
                            disabled={actioningId === expense.id}
                            title="Anular"
                            className="p-1.5 rounded hover:bg-red-100 text-red-700 disabled:opacity-50"
                          >
                            {actioningId === expense.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <XCircle className="h-4 w-4" />
                            )}
                          </button>
                        </>
                      )}
                      {expense.status === 'VALIDATED' && (
                        <button
                          onClick={() => handleVoid(expense.id)}
                          disabled={actioningId === expense.id}
                          title="Anular"
                          className="p-1.5 rounded hover:bg-red-100 text-red-700 disabled:opacity-50"
                        >
                          {actioningId === expense.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && (
        <ExpenseCreateModal
          tenantId={tenantId}
          buildingId=""
          period={period}
          mode="tenant"
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            onRefresh();
          }}
        />
      )}

      {editingExpense && (
        <ExpenseCreateModal
          tenantId={tenantId}
          buildingId=""
          period={period}
          mode="tenant"
          modeForm="edit"
          initialExpense={editingExpense}
          onClose={() => setEditingExpense(null)}
          onCreated={() => {
            setEditingExpense(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}
