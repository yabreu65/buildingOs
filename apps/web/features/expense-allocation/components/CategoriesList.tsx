'use client';

import { useState } from 'react';
import { Trash2, Edit, Zap } from 'lucide-react';
import { useCategories, useDeleteCategory } from '../index';
import { UnitCategory } from '../services/expense-categories.api';
import AutoAssignModal from './AutoAssignModal';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { Table, THead, TR, TH, TD, TBody } from '@/shared/components/ui/Table';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useToast } from '@/shared/components/ui/Toast';

interface CategoriesListProps {
  tenantId: string;
  buildingId: string;
  onEditCategory: (category: UnitCategory) => void;
  onAutoAssignClick: () => void;
}

export default function CategoriesList({
  tenantId,
  buildingId,
  onEditCategory,
  onAutoAssignClick,
}: CategoriesListProps) {
  const { toast } = useToast();
  const { data: categories, isPending, error } = useCategories(tenantId, buildingId);
  const { mutate: deleteCategory, isPending: isDeleting } = useDeleteCategory(tenantId, buildingId);
  const [toDeleteId, setToDeleteId] = useState<string | null>(null);
  const [showAutoAssignModal, setShowAutoAssignModal] = useState(false);

  const handleDelete = (id: string) => {
    if (confirm('¿Eliminar esta categoría?')) {
      deleteCategory(id);
      toast('Categoría eliminada', 'success');
      setToDeleteId(null);
    }
  };

  const handleAutoAssignClick = () => {
    setShowAutoAssignModal(true);
  };

  if (isPending) {
    return (
      <Card>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-red-50 border-red-200">
        <p className="text-sm text-red-700">Error al cargar categorías</p>
      </Card>
    );
  }

  const activeCategories = categories.filter((c) => c.active);
  const inactiveCategories = categories.filter((c) => !c.active);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Categorías (m²)</h3>
        <Button
          size="sm"
          onClick={handleAutoAssignClick}
          className="flex items-center gap-2"
        >
          <Zap className="w-4 h-4" />
          Auto-asignar
        </Button>
      </div>

      {/* Auto-Assign Modal */}
      {showAutoAssignModal && (
        <AutoAssignModal
          tenantId={tenantId}
          buildingId={buildingId}
          onClose={() => setShowAutoAssignModal(false)}
          onSuccess={() => {
            setShowAutoAssignModal(false);
          }}
        />
      )}

      {/* Active Categories */}
      {activeCategories.length > 0 && (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Nombre</TH>
                <TH>Rango m²</TH>
                <TH>Coeficiente</TH>
                <TH>Acciones</TH>
              </TR>
            </THead>
            <TBody>
              {activeCategories.map((cat) => (
                <TR key={cat.id}>
                  <TD>{cat.name}</TD>
                  <TD className="text-sm">
                    {cat.minM2} - {cat.maxM2 === null ? '∞' : cat.maxM2}
                  </TD>
                  <TD className="font-mono">{cat.coefficient.toFixed(2)}</TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onEditCategory(cat)}
                        className="p-1.5 hover:bg-gray-100 rounded"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(cat.id)}
                        disabled={isDeleting}
                        className="p-1.5 hover:bg-red-50 rounded text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {/* Inactive Categories */}
      {inactiveCategories.length > 0 && (
        <Card className="opacity-60">
          <p className="text-xs text-gray-500 mb-3">Categorías inactivas</p>
          <Table>
            <THead>
              <TR>
                <TH>Nombre</TH>
                <TH>Rango m²</TH>
                <TH>Coeficiente</TH>
              </TR>
            </THead>
            <TBody>
              {inactiveCategories.map((cat) => (
                <TR key={cat.id} className="opacity-50">
                  <TD>{cat.name}</TD>
                  <TD className="text-sm">
                    {cat.minM2} - {cat.maxM2 === null ? '∞' : cat.maxM2}
                  </TD>
                  <TD className="font-mono">{cat.coefficient.toFixed(2)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {/* Empty State */}
      {categories.length === 0 && (
        <Card className="text-center py-8">
          <p className="text-sm text-gray-500">Sin categorías. Crea una para empezar.</p>
        </Card>
      )}
    </div>
  );
}
