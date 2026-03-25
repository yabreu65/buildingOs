'use client';

import { useState, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { apiClient } from '@/shared/lib/http/client';

interface Resident {
  id: string;
  name: string;
  email?: string;
}

interface AssignResidentModalProps {
  tenantId: string;
  buildingId: string;
  unitId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AssignResidentModal({
  tenantId,
  buildingId,
  unitId,
  onClose,
  onSuccess,
}: AssignResidentModalProps) {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [selectedResidentId, setSelectedResidentId] = useState<string>('');
  const [role, setRole] = useState<'OWNER' | 'RESIDENT'>('RESIDENT');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    const fetchResidents = async () => {
      try {
        setLoading(true);
        const data = await apiClient<Resident[]>({
          path: `/tenants/${tenantId}/memberships`,
          method: 'GET',
        });
        setResidents(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading residents');
      } finally {
        setLoading(false);
      }
    };

    fetchResidents();
  }, [tenantId]);

  const handleAssign = async () => {
    if (!selectedResidentId) {
      setError('Please select a resident');
      return;
    }

    setAssigning(true);
    setError(null);

    try {
      await apiClient({
        path: `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}/occupants`,
        method: 'POST',
        body: {
          userId: selectedResidentId,
          role,
        },
      });

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error assigning resident');
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Assign Resident</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-gray-500">Loading residents...</div>
        ) : residents.length === 0 ? (
          <div className="py-8 text-center text-gray-500">No residents available</div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Select Resident</label>
                <select
                  value={selectedResidentId}
                  onChange={(e) => setSelectedResidentId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Select --</option>
                  {residents.map((resident) => (
                    <option key={resident.id} value={resident.id}>
                      {resident.name} {resident.email ? `(${resident.email})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'OWNER' | 'RESIDENT')}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="RESIDENT">Residente</option>
                  <option value="OWNER">Propietario</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <Button
                onClick={onClose}
                variant="ghost"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAssign}
                disabled={!selectedResidentId || assigning}
                className="flex-1 flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {assigning ? 'Assigning...' : 'Assign'}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
