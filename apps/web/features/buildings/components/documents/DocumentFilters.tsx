'use client';

import React from 'react';
import Button from '@/shared/components/ui/Button';
import { DocumentCategory, DocumentVisibility } from '../../services/documents.api';

interface DocumentFiltersProps {
  onCategoryChange: (category: DocumentCategory | null) => void;
  onVisibilityChange: (visibility: DocumentVisibility | null) => void;
  selectedCategory: DocumentCategory | null;
  selectedVisibility: DocumentVisibility | null;
}

const CATEGORIES: { value: DocumentCategory; label: string }[] = [
  { value: 'RULES', label: 'Reglamento' },
  { value: 'MINUTES', label: 'Actas' },
  { value: 'CONTRACT', label: 'Contrato' },
  { value: 'BUDGET', label: 'Presupuesto' },
  { value: 'INVOICE', label: 'Factura' },
  { value: 'RECEIPT', label: 'Recibo' },
  { value: 'OTHER', label: 'Otro' },
];

const VISIBILITIES: { value: DocumentVisibility; label: string }[] = [
  { value: 'TENANT_ADMINS', label: 'Solo Admins' },
  { value: 'RESIDENTS', label: 'Residentes' },
  { value: 'PRIVATE', label: 'Privado' },
];

export function DocumentFilters({
  onCategoryChange,
  onVisibilityChange,
  selectedCategory,
  selectedVisibility,
}: DocumentFiltersProps) {
  return (
    <div className="space-y-4 mb-6">
      {/* Category Filter */}
      <div>
        <p className="text-sm font-medium mb-2">Categoría</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={selectedCategory === null ? 'primary' : 'secondary'}
            onClick={() => onCategoryChange(null)}
          >
            Todas
          </Button>
          {CATEGORIES.map((cat) => (
            <Button
              key={cat.value}
              size="sm"
              variant={selectedCategory === cat.value ? 'primary' : 'secondary'}
              onClick={() => onCategoryChange(cat.value)}
            >
              {cat.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Visibility Filter */}
      <div>
        <p className="text-sm font-medium mb-2">Acceso</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={selectedVisibility === null ? 'primary' : 'secondary'}
            onClick={() => onVisibilityChange(null)}
          >
            Todos
          </Button>
          {VISIBILITIES.map((vis) => (
            <Button
              key={vis.value}
              size="sm"
              variant={selectedVisibility === vis.value ? 'primary' : 'secondary'}
              onClick={() => onVisibilityChange(vis.value)}
            >
              {vis.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
