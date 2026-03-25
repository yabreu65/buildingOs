'use client';

import { useState, useEffect } from 'react';
import { AlertCircle, Check, AlertTriangle, Info, Loader, X } from 'lucide-react';
import { useAutoAssignPreview, useAutoAssign } from '../index';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useToast } from '@/shared/components/ui/Toast';

interface AutoAssignModalProps {
  buildingId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function AutoAssignModal({ buildingId, onClose, onSuccess }: AutoAssignModalProps) {
  const { toast } = useToast();
  const [force, setForce] = useState(false);

  // Fetch preview with current force value
  const { data: previewResult, isPending: isPreviewLoading } = useAutoAssignPreview(
    buildingId,
    force
  );
  const { mutateAsync: autoAssign, isPending: isAssigning } = useAutoAssign(buildingId);

  const handleAssign = async () => {
    try {
      await autoAssign(force);
      toast('Asignación automática completada', 'success');
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al asignar categorías';
      toast('Error al asignar categorías', 'error');
      console.error(msg);
    }
  };

  const isLoading = isPreviewLoading || isAssigning;
  const canAssign = previewResult && (previewResult.assigned > 0 || force);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <Check className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold">Asignación Automática</h3>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Loading state */}
        {isPreviewLoading && (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {/* Preview Results */}
        {previewResult && !isPreviewLoading && (
          <div className="space-y-4">
            {/* Assigned */}
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-start gap-3">
                <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-green-700">{previewResult.assigned} unidades</p>
                  <p className="text-sm text-green-600">Se asignarán a sus categorías</p>
                </div>
              </div>
            </div>

            {/* Unassigned (no matching range) */}
            {previewResult.unassigned.length > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold text-amber-700">
                      {previewResult.unassigned.length} sin rango match
                    </p>
                    <p className="text-sm text-amber-600 mb-2">
                      No tienen categoría que coincida con su m²
                    </p>
                    {previewResult.unassigned.length <= 10 && (
                      <ul className="text-xs space-y-1">
                        {previewResult.unassigned.map((unit) => (
                          <li key={unit.id} className="text-amber-600">
                            • {unit.code || unit.label} (m²: {unit.m2 ?? 'sin valor'})
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* No m2 */}
            {previewResult.noM2.length > 0 && (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-gray-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold text-gray-700">
                      {previewResult.noM2.length} sin m² asignado
                    </p>
                    <p className="text-sm text-gray-600 mb-2">
                      Necesitan m² para poder ser categorizadas
                    </p>
                    {previewResult.noM2.length <= 10 && (
                      <ul className="text-xs space-y-1">
                        {previewResult.noM2.map((unit) => (
                          <li key={unit.id} className="text-gray-600">
                            • {unit.code || unit.label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Force checkbox */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="force-checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                disabled={isLoading}
                className="w-4 h-4 rounded border-gray-300"
              />
              <label
                htmlFor="force-checkbox"
                className="text-sm font-medium text-gray-700 cursor-pointer"
              >
                Re-asignar unidades ya asignadas
              </label>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-4 mt-4 border-t">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleAssign}
            disabled={!canAssign || isLoading}
            className="flex-1 flex items-center justify-center gap-2"
          >
            {isAssigning ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Asignando...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Asignar
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
