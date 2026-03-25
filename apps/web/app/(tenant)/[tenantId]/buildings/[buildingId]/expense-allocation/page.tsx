'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import {
  CategoriesList,
  CategoryForm,
  PeriodsList,
  PeriodForm,
  PeriodDetail,
  UnitCategory,
  ExpensePeriod,
} from '@/features/expense-allocation';

interface BuildingParams {
  tenantId: string;
  buildingId: string;
  [key: string]: string | string[];
}

/**
 * ExpenseAllocationPage: Manage expense proration by m² categories
 *
 * This page allows building admins to:
 * 1. Define unit categories based on m² ranges and coefficients
 * 2. Auto-assign units to categories
 * 3. Create and manage expense periods
 * 4. Generate and publish charges with automatic proration
 */
export default function ExpenseAllocationPage() {
  const { tenantId, buildingId } = useParams<BuildingParams>();
  const tenantIdStr = typeof tenantId === 'string' ? tenantId : undefined;
  const buildingIdStr = typeof buildingId === 'string' ? buildingId : undefined;

  // Category form state
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<UnitCategory | undefined>();

  // Period form state
  const [showPeriodForm, setShowPeriodForm] = useState(false);

  // Period selection state
  const [selectedPeriod, setSelectedPeriod] = useState<ExpensePeriod | undefined>();

  const handleEditCategory = (category: UnitCategory) => {
    setSelectedCategory(category);
    setShowCategoryForm(true);
  };

  const handleFormSuccess = () => {
    setShowCategoryForm(false);
    setSelectedCategory(undefined);
  };

  const handlePeriodFormSuccess = () => {
    setShowPeriodForm(false);
    setSelectedPeriod(undefined);
  };

  if (!tenantIdStr || !buildingIdStr) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantIdStr}
        buildingName="Asignación de Gastos"
        buildingId={buildingIdStr}
      />

      <BuildingSubnav tenantId={tenantIdStr} buildingId={buildingIdStr} />

      <div className="grid grid-cols-3 gap-6">
        {/* Main Content - 2 columns */}
        <div className="col-span-2 space-y-8">
          {/* Categories Section */}
          <section>
            <CategoriesList
              buildingId={buildingIdStr}
              onEditCategory={handleEditCategory}
              onAutoAssignClick={() => {
                // TODO: Show auto-assign preview modal
              }}
            />
          </section>

          {/* Periods Section */}
          <section>
            <PeriodsList
              buildingId={buildingIdStr}
              onCreateClick={() => setShowPeriodForm(true)}
              onPeriodClick={setSelectedPeriod}
            />
          </section>
        </div>

        {/* Sidebar - 1 column */}
        <aside className="col-span-1 space-y-4">
          {/* Category Form Modal */}
          {showCategoryForm && (
            <CategoryForm
              buildingId={buildingIdStr}
              category={selectedCategory}
              onSuccess={handleFormSuccess}
              onCancel={() => {
                setShowCategoryForm(false);
                setSelectedCategory(undefined);
              }}
            />
          )}

          {/* Period Form Modal */}
          {showPeriodForm && (
            <PeriodForm
              buildingId={buildingIdStr}
              onSuccess={handlePeriodFormSuccess}
              onCancel={() => setShowPeriodForm(false)}
            />
          )}

          {/* Period Detail */}
          {selectedPeriod && !showPeriodForm && (
            <PeriodDetail
              buildingId={buildingIdStr}
              period={selectedPeriod}
              onClose={() => setSelectedPeriod(undefined)}
              onSuccess={() => {
                setSelectedPeriod(undefined);
              }}
            />
          )}

          {/* Empty Detail State */}
          {!selectedPeriod && !showPeriodForm && (
            <div className="bg-gray-50 rounded-lg p-6 text-center">
              <p className="text-sm text-gray-500">
                Selecciona un período para ver detalles
              </p>
            </div>
          )}

          {/* Create Category Button */}
          {!showCategoryForm && (
            <button
              onClick={() => setShowCategoryForm(true)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              + Nueva Categoría
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
