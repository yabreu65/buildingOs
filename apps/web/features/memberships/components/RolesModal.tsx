'use client';

import React, { useState, useEffect } from 'react';
import { useMemberRoles } from '../useMemberRoles';
import { AddRoleInput } from '../memberships.api';
import { ScopedRole } from '../../auth/auth.types';
import { useUnits } from '@/features/buildings/hooks/useUnits';

interface Building {
  id: string;
  name: string;
}

interface Unit {
  id: string;
  label: string;
  unitCode?: string;
}

interface RolesModalProps {
  isOpen: boolean;
  tenantId: string;
  membershipId: string;
  memberName: string;
  buildings: Building[];
  onClose: () => void;
}

type ScopeType = 'TENANT' | 'BUILDING' | 'UNIT';

/**
 * RolesModal: administrar roles con alcance para un miembro operativo
 *
 * Funcionalidades:
 * - Listar roles existentes con alcance
 * - Agregar nuevos roles con selección de alcance
 * - Selección encadenada de edificio/unidad
 * - Eliminar roles con confirmación
 */
export function RolesModal({
  isOpen,
  tenantId,
  membershipId,
  memberName,
  buildings,
  onClose,
}: RolesModalProps) {
  // Form state
  const [role, setRole] = useState<string>('OPERATOR');
  const [scopeType, setScopeType] = useState<ScopeType>('TENANT');
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  const { roles, loading, error, isAdding, addError, addRole, removeRole } =
    useMemberRoles(tenantId, membershipId);

  // Use hook to fetch units for selected building
  const { units: fetchedUnits, loading: unitsLoading } = useUnits(
    tenantId || undefined,
    selectedBuildingId || undefined,
  );

  // Reset unit selection when building changes, update units list
  useEffect(() => {
    setSelectedUnitId('');
  }, [selectedBuildingId]);

  const handleAddRole = async () => {
    setFormError(null);

    try {
      const input: AddRoleInput = {
        role,
        scopeType,
      };

      if (scopeType === 'BUILDING' && !selectedBuildingId) {
        setFormError('Please select a building');
        return;
      }
      if (scopeType === 'BUILDING') {
        input.scopeBuildingId = selectedBuildingId;
      }

      if (scopeType === 'UNIT' && !selectedUnitId) {
        setFormError('Please select a unit');
        return;
      }
      if (scopeType === 'UNIT') {
        input.scopeUnitId = selectedUnitId;
        // For UNIT scope, scopeBuildingId is not set (it's implicit from the unit)
      }

      await addRole(input);

      // Reset form
      setRole('OPERATOR');
      setScopeType('TENANT');
      setSelectedBuildingId('');
      setSelectedUnitId('');
    } catch (error) {
      // Error is handled by hook's addError state
    }
  };

  const handleRemoveRole = async (roleId: string) => {
    if (window.confirm('Remove this role?')) {
      try {
        await removeRole(roleId);
      } catch (error) {
        // Error is handled
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background text-foreground shadow-2xl">
        <div className="border-b border-border p-6">
          <h2 className="text-lg font-semibold">Gestionar roles: {memberName}</h2>
        </div>

        <div className="p-6 space-y-6">
          {/* Existing Roles List */}
          <div>
            <h3 className="text-sm font-medium mb-3">Roles actuales</h3>
            {loading ? (
              <div className="text-sm text-muted-foreground">Cargando roles...</div>
            ) : roles.length === 0 ? (
              <div className="text-sm text-muted-foreground">Todavía no hay roles asignados</div>
            ) : (
              <div className="space-y-2">
                {roles.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-md border border-border bg-muted/50 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{r.role}</span>
                      <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                        {formatScope(r, buildings, fetchedUnits)}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveRole(r.id)}
                      className="text-red-500 hover:text-red-400 text-sm"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add Role Form */}
          <div className="border-t pt-6">
            <h3 className="text-sm font-medium mb-3">Agregar rol</h3>
            <div className="space-y-4">
              {formError && (
                <div className="text-sm text-red-500 bg-red-500/10 p-2 rounded">
                  {formError}
                </div>
              )}
              {addError && (
                <div className="text-sm text-red-500 bg-red-500/10 p-2 rounded">
                  {addError}
                </div>
              )}
              {error && (
                <div className="text-sm text-red-500 bg-red-500/10 p-2 rounded">
                  {error}
                </div>
              )}

              {/* Role Select */}
              <div>
                <label className="mb-1 block text-xs font-medium">Rol</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none ring-0 focus:border-primary"
                >
                  <option value="TENANT_OWNER">Propietario</option>
                  <option value="TENANT_ADMIN">Administrador</option>
                  <option value="OPERATOR">Operador</option>
                  <option value="RESIDENT">Residente</option>
                </select>
              </div>

              {/* Scope Type Select */}
              <div>
                <label className="mb-1 block text-xs font-medium">Alcance</label>
                <select
                  value={scopeType}
                  onChange={(e) => setScopeType(e.target.value as ScopeType)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-primary"
                >
                  <option value="TENANT">Todo el condominio</option>
                  <option value="BUILDING">Edificio específico</option>
                  <option value="UNIT">Unidad específica</option>
                </select>
              </div>

              {/* Building Select (for BUILDING or UNIT scope) */}
              {(scopeType === 'BUILDING' || scopeType === 'UNIT') && (
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    Edificio
                  </label>
                  <select
                    value={selectedBuildingId}
                    onChange={(e) => setSelectedBuildingId(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:border-primary"
                  >
                    <option value="">Selecciona un edificio...</option>
                    {buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Unit Select (for UNIT scope) */}
              {scopeType === 'UNIT' && (
                <div>
                  <label className="mb-1 block text-xs font-medium">Unidad</label>
                  <select
                    value={selectedUnitId}
                    onChange={(e) => setSelectedUnitId(e.target.value)}
                    disabled={!selectedBuildingId || unitsLoading}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none disabled:cursor-not-allowed disabled:opacity-50 focus:border-primary"
                  >
                    <option value="">
                      {unitsLoading ? 'Cargando unidades...' : 'Selecciona una unidad...'}
                    </option>
                    {fetchedUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label || u.unitCode}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Add Button */}
              <button
                onClick={handleAddRole}
                disabled={isAdding}
                className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAdding ? 'Agregando...' : 'Agregar rol'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border p-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function formatScope(role: ScopedRole, buildings: Building[] = [], units: Unit[] = []): string {
  if (role.scopeType === 'TENANT') return 'Todo el condominio';

  if (role.scopeType === 'BUILDING' && role.scopeBuildingId) {
    const building = buildings.find((b) => b.id === role.scopeBuildingId);
    return `Edificio: ${building?.name || role.scopeBuildingId}`;
  }

  if (role.scopeType === 'UNIT' && role.scopeUnitId) {
    const unit = units.find((u) => u.id === role.scopeUnitId);
    return `Unidad: ${unit?.label || unit?.unitCode || role.scopeUnitId}`;
  }

  return role.scopeType;
}
