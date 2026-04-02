'use client';

import { useState } from 'react';
import { Plus, Trash2, Edit2, Loader2, Eye, EyeOff } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import { useToast } from '@/shared/components/ui/Toast';
import { ExpenseLedgerCategory } from '../services/expense-ledger.api';
import {
  useExpenseLedgerCategories,
  useCreateExpenseLedgerCategory,
  useUpdateExpenseLedgerCategory,
  useDeleteExpenseLedgerCategory,
} from '../hooks/useExpenseLedger';

interface ExpenseLedgerCategoriesManagerProps {
  tenantId: string;
}

interface CategoryFormState {
  id?: string;
  name: string;
  description: string;
  movementType: 'EXPENSE' | 'INCOME';
}

type Tab = 'EXPENSE' | 'INCOME';

export function ExpenseLedgerCategoriesManager({
  tenantId,
}: ExpenseLedgerCategoriesManagerProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('EXPENSE');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<CategoryFormState>({
    name: '',
    description: '',
    movementType: 'EXPENSE',
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: allCategories = [], isPending } = useExpenseLedgerCategories(tenantId);
  const createMutation = useCreateExpenseLedgerCategory(tenantId);
  const updateMutation = useUpdateExpenseLedgerCategory(tenantId);
  const deleteMutation = useDeleteExpenseLedgerCategory(tenantId);

  const categories = allCategories.filter((c) => c.movementType === activeTab);

  const handleOpenCreate = () => {
    setEditingId(null);
    setForm({ name: '', description: '', movementType: activeTab });
    setShowModal(true);
  };

  const handleOpenEdit = (category: ExpenseLedgerCategory) => {
    setEditingId(category.id);
    setForm({
      id: category.id,
      name: category.name,
      description: category.description || '',
      movementType: category.movementType,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name.trim()) {
      toast('El nombre del rubro es obligatorio', 'error');
      return;
    }

    try {
      if (editingId) {
        await updateMutation.mutateAsync({
          categoryId: editingId,
          data: {
            name: form.name.trim(),
            description: form.description.trim() || undefined,
          },
        });
        toast('Rubro actualizado', 'success');
      } else {
        await createMutation.mutateAsync({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          movementType: form.movementType,
        });
        toast('Rubro creado', 'success');
      }
      setShowModal(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar el rubro';
      toast(msg, 'error');
    }
  };

  const handleToggleActive = async (category: ExpenseLedgerCategory) => {
    try {
      await updateMutation.mutateAsync({
        categoryId: category.id,
        data: { isActive: !category.isActive },
      });
      toast(
        category.isActive ? 'Rubro desactivado' : 'Rubro activado',
        'success',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al actualizar el rubro';
      toast(msg, 'error');
    }
  };

  const handleDelete = async (categoryId: string) => {
    if (!confirm('¿Estás seguro de que querés eliminar este rubro?')) return;

    try {
      await deleteMutation.mutateAsync(categoryId);
      toast('Rubro eliminado', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al eliminar el rubro';
      toast(msg, 'error');
    }
  };

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tabLabel = activeTab === 'EXPENSE' ? 'Gastos' : 'Ingresos';
  const tabIcon = activeTab === 'EXPENSE' ? '💸' : '💰';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">
            Catálogo de Rubros
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gestiona los rubros de {activeTab === 'EXPENSE' ? 'gastos' : 'ingresos'}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleOpenCreate}
        >
          <Plus className="h-4 w-4 mr-1" />
          Nuevo rubro
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {(['EXPENSE', 'INCOME'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'EXPENSE' ? '💸 Gastos' : '💰 Ingresos'}
          </button>
        ))}
      </div>

      {/* Lista */}
      {categories.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No hay rubros de {tabLabel.toLowerCase()} creados todavía.
          <br />
          <span className="text-xs">
            Crea rubros antes de registrar {tabLabel.toLowerCase()}.
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((category) => (
            <div
              key={category.id}
              className={`flex items-center justify-between p-4 rounded-lg border transition ${
                category.isActive
                  ? 'bg-background hover:bg-muted/30'
                  : 'bg-muted/40 opacity-75'
              }`}
            >
              <div className="flex-1">
                <h4 className="font-medium">{category.name}</h4>
                {category.description && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {category.description}
                  </p>
                )}
                {category.code && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Código: {category.code}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {category.isActive ? (
                    <span className="text-green-600">✓ Activo</span>
                  ) : (
                    <span className="text-gray-500">Inactivo</span>
                  )}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleToggleActive(category)}
                  title={category.isActive ? 'Desactivar' : 'Activar'}
                  className="p-2 rounded hover:bg-amber-100 text-amber-700 disabled:opacity-50"
                  disabled={updateMutation.isPending}
                >
                  {category.isActive ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <EyeOff className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={() => handleOpenEdit(category)}
                  title="Editar"
                  className="p-2 rounded hover:bg-blue-100 text-blue-700 disabled:opacity-50"
                  disabled={updateMutation.isPending}
                >
                  <Edit2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(category.id)}
                  title="Eliminar"
                  className="p-2 rounded hover:bg-red-100 text-red-700 disabled:opacity-50"
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">
              {editingId ? 'Editar rubro' : 'Crear rubro'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Electricidad"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Descripción (opcional)
                </label>
                <textarea
                  placeholder="Ej: Gastos de electricidad de la edificación"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {!editingId && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Tipo de Rubro
                  </label>
                  <select
                    value={form.movementType}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        movementType: e.target.value as 'EXPENSE' | 'INCOME',
                      }))
                    }
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="EXPENSE">💸 Gasto</option>
                    <option value="INCOME">💰 Ingreso</option>
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowModal(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : null}
                  {editingId ? 'Actualizar' : 'Crear'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
