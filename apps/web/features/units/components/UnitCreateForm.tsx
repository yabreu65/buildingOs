'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Input from '@/shared/components/ui/Input';
import { X, Loader2 } from 'lucide-react';
import type { Unit } from '@/features/units/units.api';

/**
 * UnitCreateForm: Unified component for creating units
 * Reusable in two contexts:
 * 1. Building-scoped: defaultBuildingId provided, building selector hidden
 * 2. Global/Tenant-scoped: no defaultBuildingId, building selector visible and required
 */

interface Building {
  id: string;
  name: string;
}

interface UnitCreateFormProps {
  tenantId: string;
  buildings: Building[];
  defaultBuildingId?: string; // If provided, building is pre-selected and hidden
  onSuccess: (unit: Unit) => void;
  onCancel: () => void;
  onCreateUnit: (buildingId: string, input: {
    code: string;
    label?: string;
    unitType?: string;
    occupancyStatus?: string;
    m2?: number;
  }) => Promise<Unit>;
}

// Shared validation schema
const unitSchema = z.object({
  code: z.string().min(1, 'Unit code is required').trim(),
  label: z.string().optional(),
  unitType: z.enum(['APARTMENT', 'HOUSE', 'OFFICE', 'STORAGE', 'PARKING', 'OTHER']).optional(),
  occupancyStatus: z.enum(['UNKNOWN', 'VACANT', 'OCCUPIED']).optional(),
  m2: z.union([z.number().positive('m² must be a positive number'), z.undefined()]).optional(),
  buildingId: z.string().min(1, 'Building is required'),
});

type UnitFormData = z.infer<typeof unitSchema>;

const UNIT_TYPES = [
  { value: 'APARTMENT', label: 'Apartment' },
  { value: 'HOUSE', label: 'House' },
  { value: 'OFFICE', label: 'Office' },
  { value: 'STORAGE', label: 'Storage' },
  { value: 'PARKING', label: 'Parking' },
  { value: 'OTHER', label: 'Other' },
];

const OCCUPANCY_STATUSES = [
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'VACANT', label: 'Vacant' },
  { value: 'OCCUPIED', label: 'Occupied' },
];

export default function UnitCreateForm({
  tenantId,
  buildings,
  defaultBuildingId,
  onSuccess,
  onCancel,
  onCreateUnit,
}: UnitCreateFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<UnitFormData>({
    resolver: zodResolver(unitSchema),
    defaultValues: {
      code: '',
      label: '',
      buildingId: defaultBuildingId || '',
      unitType: 'APARTMENT',
      occupancyStatus: 'UNKNOWN',
      m2: undefined,
    },
  });

  const handleCreate = async (data: UnitFormData) => {
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const unit = await onCreateUnit(data.buildingId, {
        code: data.code,
        label: data.label,
        unitType: data.unitType,
        occupancyStatus: data.occupancyStatus,
        m2: data.m2,
      });

      reset();
      onSuccess(unit);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create unit';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBuildingScoped = !!defaultBuildingId;

  return (
    <Card className="border-blue-200 bg-blue-50">
      <div className="mb-4 flex justify-between items-center">
        <h3 className="text-lg font-semibold">
          {isBuildingScoped ? 'Create New Unit' : 'Create Unit in Building'}
        </h3>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {submitError && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-md text-red-700 text-sm">
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit(handleCreate)} className="space-y-4">
        {/* Building Selector - Only shown in global context */}
        {!isBuildingScoped && (
          <div>
            <label htmlFor="buildingId" className="block text-sm font-medium mb-1">
              Building *
            </label>
            <select
              id="buildingId"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...register('buildingId')}
            >
              <option value="">Select a building</option>
              {buildings.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.name}
                </option>
              ))}
            </select>
            {errors.buildingId && (
              <p className="text-xs text-red-600 mt-1">{errors.buildingId.message}</p>
            )}
          </div>
        )}

        {/* Code - Always required */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="code" className="block text-sm font-medium mb-1">
              Unit Code *
            </label>
            <Input
              id="code"
              placeholder="e.g., 101"
              {...register('code')}
              className={errors.code ? 'border-red-500' : ''}
            />
            {errors.code && (
              <p className="text-xs text-red-600 mt-1">{errors.code.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="label" className="block text-sm font-medium mb-1">
              Label (optional)
            </label>
            <Input
              id="label"
              placeholder="e.g., Apt 101"
              {...register('label')}
            />
          </div>
        </div>

        {/* m² */}
        <div>
          <label htmlFor="m2" className="block text-sm font-medium mb-1">
            m² (Square Meters) - Optional
          </label>
          <Input
            id="m2"
            type="number"
            placeholder="e.g., 65"
            step="0.01"
            {...register('m2')}
            className={errors.m2 ? 'border-red-500' : ''}
          />
          {errors.m2 && (
            <p className="text-xs text-red-600 mt-1">{errors.m2.message}</p>
          )}
        </div>

        {/* Type and Occupancy */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="unitType" className="block text-sm font-medium mb-1">
              Type
            </label>
            <select
              id="unitType"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...register('unitType')}
            >
              {UNIT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="occupancyStatus" className="block text-sm font-medium mb-1">
              Occupancy Status
            </label>
            <select
              id="occupancyStatus"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...register('occupancyStatus')}
            >
              {OCCUPANCY_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-4 border-t">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Unit'
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}
