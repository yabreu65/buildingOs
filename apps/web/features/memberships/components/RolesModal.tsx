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
 * RolesModal: Manage scoped roles for a team member
 *
 * Features:
 * - List existing roles with scope badges
 * - Add new roles with scope selection
 * - Cascading building/unit selection
 * - Remove roles with confirmation
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full mx-4 max-h-96 overflow-y-auto">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold">Manage Roles: {memberName}</h2>
        </div>

        <div className="p-6 space-y-6">
          {/* Existing Roles List */}
          <div>
            <h3 className="text-sm font-medium mb-3">Current Roles</h3>
            {loading ? (
              <div className="text-sm text-gray-500">Loading roles...</div>
            ) : roles.length === 0 ? (
              <div className="text-sm text-gray-500">No roles assigned yet</div>
            ) : (
              <div className="space-y-2">
                {roles.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between bg-gray-100 p-3 rounded"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{r.role}</span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                        {formatScope(r, buildings, fetchedUnits)}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveRole(r.id)}
                      className="text-red-600 hover:text-red-800 text-sm"
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
            <h3 className="text-sm font-medium mb-3">Add Role</h3>
            <div className="space-y-4">
              {formError && (
                <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                  {formError}
                </div>
              )}
              {addError && (
                <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                  {addError}
                </div>
              )}
              {error && (
                <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                  {error}
                </div>
              )}

              {/* Role Select */}
              <div>
                <label className="block text-xs font-medium mb-1">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-3 py-2 border rounded text-sm"
                >
                  <option value="TENANT_OWNER">Tenant Owner</option>
                  <option value="TENANT_ADMIN">Tenant Admin</option>
                  <option value="OPERATOR">Operator</option>
                  <option value="RESIDENT">Resident</option>
                </select>
              </div>

              {/* Scope Type Select */}
              <div>
                <label className="block text-xs font-medium mb-1">Scope</label>
                <select
                  value={scopeType}
                  onChange={(e) => setScopeType(e.target.value as ScopeType)}
                  className="w-full px-3 py-2 border rounded text-sm"
                >
                  <option value="TENANT">Whole Tenant</option>
                  <option value="BUILDING">Specific Building</option>
                  <option value="UNIT">Specific Unit</option>
                </select>
              </div>

              {/* Building Select (for BUILDING or UNIT scope) */}
              {(scopeType === 'BUILDING' || scopeType === 'UNIT') && (
                <div>
                  <label className="block text-xs font-medium mb-1">
                    Building
                  </label>
                  <select
                    value={selectedBuildingId}
                    onChange={(e) => setSelectedBuildingId(e.target.value)}
                    className="w-full px-3 py-2 border rounded text-sm"
                  >
                    <option value="">Select a building...</option>
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
                  <label className="block text-xs font-medium mb-1">Unit</label>
                  <select
                    value={selectedUnitId}
                    onChange={(e) => setSelectedUnitId(e.target.value)}
                    disabled={!selectedBuildingId || unitsLoading}
                    className="w-full px-3 py-2 border rounded text-sm disabled:bg-gray-100"
                  >
                    <option value="">
                      {unitsLoading ? 'Loading units...' : 'Select a unit...'}
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
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white py-2 rounded text-sm font-medium"
              >
                {isAdding ? 'Adding...' : 'Add Role'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium border rounded hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function formatScope(role: ScopedRole, buildings: Building[] = [], units: Unit[] = []): string {
  if (role.scopeType === 'TENANT') return 'Tenant-wide';

  if (role.scopeType === 'BUILDING' && role.scopeBuildingId) {
    const building = buildings.find((b) => b.id === role.scopeBuildingId);
    return `Building: ${building?.name || role.scopeBuildingId}`;
  }

  if (role.scopeType === 'UNIT' && role.scopeUnitId) {
    const unit = units.find((u) => u.id === role.scopeUnitId);
    return `Unit: ${unit?.label || unit?.unitCode || role.scopeUnitId}`;
  }

  return role.scopeType;
}
