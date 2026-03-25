'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenantIdStr = typeof tenantId === 'string' ? tenantId : undefined;
  const buildingIdStr = typeof buildingId === 'string' ? buildingId : undefined;

  // Category form state
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<UnitCategory | undefined>();

  // Period form state
  const [showPeriodForm, setShowPeriodForm] = useState(false);

  // Period selection state (from URL params)
  const [selectedPeriod, setSelectedPeriod] = useState<ExpensePeriod | undefined>();
  const [allPeriods, setAllPeriods] = useState<ExpensePeriod[]>([]);

  // Load selectedPeriodId from URL on mount
  useEffect(() => {
    const selectedPeriodId = searchParams.get('periodId');
    if (selectedPeriodId && allPeriods.length > 0) {
      const period = allPeriods.find((p) => p.id === selectedPeriodId);
      if (period) {
        setSelectedPeriod(period);
      }
    }
  }, [searchParams, allPeriods]);

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

  const handlePeriodClick = (period: ExpensePeriod) => {
    setSelectedPeriod(period);
    router.push(`?periodId=${period.id}`, { scroll: false });
  };

  const handleClosePeriodDetail = () => {
    setSelectedPeriod(undefined);
    router.push('?', { scroll: false });
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
              tenantId={tenantIdStr}
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
              tenantId={tenantIdStr}
              buildingId={buildingIdStr}
              onCreateClick={() => setShowPeriodForm(true)}
              onPeriodClick={handlePeriodClick}
              onPeriodsLoaded={setAllPeriods}
            />
          </section>
        </div>

        {/* Sidebar - 1 column */}
        <aside className="col-span-1 space-y-4">
          {/* Category Form Modal */}
          {showCategoryForm && (
            <CategoryForm
              tenantId={tenantIdStr}
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
              tenantId={tenantIdStr}
              buildingId={buildingIdStr}
              onSuccess={handlePeriodFormSuccess}
              onCancel={() => setShowPeriodForm(false)}
            />
          )}

          {/* Period Detail */}
          {selectedPeriod && !showPeriodForm && (
            <PeriodDetail
              tenantId={tenantIdStr}
              buildingId={buildingIdStr}
              period={selectedPeriod}
              onClose={handleClosePeriodDetail}
              onSuccess={() => {
                setSelectedPeriod(undefined);
                router.push('?', { scroll: false });
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
