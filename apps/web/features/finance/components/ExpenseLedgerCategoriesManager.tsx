'use client';

import { useState } from 'react';
import { Plus, Trash2, Edit2, Loader2 } from 'lucide-react';
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
}

export function ExpenseLedgerCategoriesManager({
  tenantId,
}: ExpenseLedgerCategoriesManagerProps) {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<CategoryFormState>({ name: '', description: '' });
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: categories = [], isPending, refetch } = useExpenseLedgerCategories(tenantId);
  const createMutation = useCreateExpenseLedgerCategory(tenantId);
  const updateMutation = useUpdateExpenseLedgerCategory(tenantId);
  const deleteMutation = useDeleteExpenseLedgerCategory(tenantId);

  const handleOpenCreate = () => {
    setEditingId(null);
    setForm({ name: '', description: '' });
    setShowModal(true);
  };

  const handleOpenEdit = (category: ExpenseLedgerCategory) => {
    setEditingId(category.id);
    setForm({ id: category.id, name: category.name, description: category.description || '' });
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
        });
        toast('Rubro creado', 'success');
      }
      setShowModal(false);
      await refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar el rubro';
      toast(msg, 'error');
    }
  };

  const handleDelete = async (categoryId: string) => {
    if (!confirm('¿Estás seguro de que querés eliminar este rubro?')) return;

    try {
      await deleteMutation.mutateAsync(categoryId);
      toast('Rubro eliminado', 'success');
      await refetch();
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">
            Rubros de Gastos
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Crea los tipos de gastos que vas a registrar (Electricidad, Agua, Mantenimiento, etc.)
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

      {/* Lista */}
      {categories.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No hay rubros creados todavía.
          <br />
          <span className="text-xs">
            Crea al menos un rubro antes de registrar gastos.
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((category) => (
            <div
              key={category.id}
              className="flex items-center justify-between p-4 rounded-lg border bg-background hover:bg-muted/30 transition"
            >
              <div className="flex-1">
                <h4 className="font-medium">{category.name}</h4>
                {category.description && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {category.description}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {category.active ? (
                    <span className="text-green-600">✓ Activo</span>
                  ) : (
                    <span className="text-gray-500">Inactivo</span>
                  )}
                </p>
              </div>

              <div className="flex gap-2">
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
