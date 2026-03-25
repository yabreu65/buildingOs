'use client';

import { AlertCircle, CheckCircle, X } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';

interface CategoryChangeDialogProps {
  isOpen: boolean;
  unitLabel: string;
  currentCategory?: string;
  newCategory: string;
  currentM2?: number;
  newM2?: number;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

export default function CategoryChangeDialog({
  isOpen,
  unitLabel,
  currentCategory,
  newCategory,
  currentM2,
  newM2,
  onConfirm,
  onCancel,
  isLoading,
}: CategoryChangeDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Cambiar Categoría</h3>
              <p className="text-sm text-gray-500 mt-1">Unidad: {unitLabel}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current State */}
        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
            Estado Actual
          </p>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Categoría</span>
              <span className="text-sm font-medium text-gray-900">
                {currentCategory || '—'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">m²</span>
              <span className="text-sm font-medium text-gray-900">
                {currentM2 ? `${currentM2} m²` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex justify-center my-3">
          <div className="text-gray-400">↓</div>
        </div>

        {/* New State */}
        <div className="bg-green-50 rounded-lg p-4 mb-6 border border-green-200">
          <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-3">
            Nuevo Estado
          </p>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Categoría</span>
              <span className="text-sm font-semibold text-green-700 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                {newCategory}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">m²</span>
              <span className="text-sm font-semibold text-green-700 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                {newM2 ? `${newM2} m²` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 bg-green-600 hover:bg-green-700"
          >
            {isLoading ? 'Aplicando...' : 'Aplicar Cambio'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
