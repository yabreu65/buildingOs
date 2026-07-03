'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, Plus, Trash2, Calculator, Users, AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { HttpError } from '@/shared/lib/http/client';
import Button from '@/shared/components/ui/Button';
import { useToast } from '@/shared/components/ui/Toast';
import {
  useCreateExpense,
  useExpenseLedgerCategories,
  useUpdateExpense,
  useCreateAdjustment,
} from '../hooks/useExpenseLedger';
import { useTenantCurrency } from '@/features/tenancy/hooks/useTenantBranding';
import { useBuildings } from '@/features/buildings/hooks';
import { getAllocationSuggestions, getVendorSuggestion } from '../services/expense-ledger.api';
import { unitGroupApi } from '../services/liquidation.api';
import type {
  CreateExpenseData,
  ExpenseLedgerCategory,
  ExpenseScopeType,
  AllocationInput,
  AllocationSuggestion,
  VendorSuggestion,
  Expense,
} from '../services/expense-ledger.api';
import { useVendors } from '@/features/vendors';
import {
  listCountryCatalogVendors,
  importCountryCatalogVendor,
  type CountryCatalogVendor,
} from '@/features/vendors';
import VendorCreateModal from '@/features/vendors/components/VendorCreateModal';

interface ExpenseCreateModalProps {
  tenantId: string;
  buildingId: string;
  period: string;
  onClose: () => void;
  onCreated: () => void;
  /** Modo de captura: 'building' = solo gastos de edificio, 'tenant' = permite gastos comunes */
  mode?: 'building' | 'tenant';
  modeForm?: 'create' | 'edit';
  initialExpense?: Expense;
}

type ExpenseFieldKey =
  | 'categoryId'
  | 'amountMinor'
  | 'currencyCode'
  | 'invoiceDate'
  | 'description'
  | 'scopeType'
  | 'buildingId'
  | 'unitGroupId'
  | 'adjustmentReason'
  | 'vendorSearch'
  | 'allocations';

const expenseFieldIds = {
  scopeType: 'expense-scope-type',
  buildingId: 'expense-building-id',
  unitGroupId: 'expense-unit-group-id',
  categoryId: 'expense-category-id',
  amountMinor: 'expense-amount-minor',
  currencyCode: 'expense-currency-code',
  invoiceDate: 'expense-invoice-date',
  vendorId: 'expense-vendor-id',
  vendorSearch: 'expense-vendor-search',
  description: 'expense-description',
  adjustmentReason: 'expense-adjustment-reason',
  allocationBuildingPrefix: 'expense-allocation-building',
  allocationPercentagePrefix: 'expense-allocation-percentage',
} as const;

interface UnitGroupOption {
  id: string;
  name: string;
}

interface SuggestedVendorInfo {
  vendorId: string;
  vendorName: string;
  source: VendorSuggestion['source'];
}

function toInputDate(value: string): string {
  if (!value) return value;
  return value.includes('T') ? value.slice(0, 10) : value;
}

function isExpenseScopeType(value: unknown): value is ExpenseScopeType {
  return value === 'BUILDING' || value === 'TENANT_SHARED' || value === 'UNIT_GROUP';
}

function isUnitGroupOption(value: unknown): value is UnitGroupOption {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'name') === 'string'
  );
}

function isUnitGroupOptionList(value: unknown): value is UnitGroupOption[] {
  return Array.isArray(value) && value.every(isUnitGroupOption);
}

function getReadableErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    const apiMessage = error.data?.message;
    if (typeof apiMessage === 'string' && apiMessage.trim()) {
      return apiMessage;
    }

    if (Array.isArray(apiMessage) && apiMessage.length > 0) {
      return apiMessage.join(', ');
    }

    if (error.message.trim()) {
      return error.message;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export const ExpenseCreateModal = ({
  tenantId,
  buildingId: initialBuildingId,
  period,
  onClose,
  onCreated,
  mode = 'building',
  modeForm = 'create',
  initialExpense,
}: ExpenseCreateModalProps) => {
  const { toast } = useToast();
  const { currency } = useTenantCurrency();
  const { buildings, loading: buildingsLoading } = useBuildings(tenantId);
  const createMutation = useCreateExpense(tenantId);
  const updateMutation = useUpdateExpense(tenantId);

  const isEditMode = modeForm === 'edit' && !!initialExpense;
  const defaultScopeType: ExpenseScopeType = isExpenseScopeType(initialExpense?.scopeType)
    ? initialExpense.scopeType
    : mode === 'tenant'
      ? 'TENANT_SHARED'
      : 'BUILDING';

  const [form, setForm] = useState({
    categoryId: initialExpense?.categoryId ?? '',
    vendorId: initialExpense?.vendorId ?? '',
    amountMinor: initialExpense ? String(initialExpense.amountMinor / 100) : '',
    currencyCode: initialExpense?.currencyCode ?? currency,
    invoiceDate: initialExpense
      ? toInputDate(initialExpense.invoiceDate)
      : (() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })(),
    description: initialExpense?.description ?? '',
    scopeType: defaultScopeType,
    buildingId: initialExpense?.buildingId ?? initialBuildingId ?? '',
    unitGroupId: initialExpense?.unitGroupId ?? '',
  });

  const [showVendorCreate, setShowVendorCreate] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');
  const [countryLoading, setCountryLoading] = useState(false);
  const [countryCatalogResults, setCountryCatalogResults] = useState<CountryCatalogVendor[]>([]);
  const [importingVendorId, setImportingVendorId] = useState<string | null>(null);
  const [suggestedVendorError, setSuggestedVendorError] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ExpenseFieldKey, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const effectiveBuildingId = form.buildingId || initialBuildingId || '';
  const {
    allVendors,
    loading: vendorsLoading,
    error: vendorsError,
    refetch: refetchVendors,
  } = useVendors({ buildingId: effectiveBuildingId || undefined });

  // Derivar liquidationPeriod desde invoiceDate
  const derivedPeriod = useMemo(() => {
    const d = new Date(form.invoiceDate);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }, [form.invoiceDate]);

  // Estado para modo ajuste (cuando período está cerrado)
  const [isAdjustmentMode, setIsAdjustmentMode] = useState(false);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const createAdjustmentMutation = useCreateAdjustment(tenantId);

  const selectedBuildingName =
    buildings.find((building) => building.id === effectiveBuildingId)?.name ??
    initialBuildingId;

  const scopeSummary = useMemo(() => {
    if (isEditMode) {
      return 'Editando un gasto en borrador';
    }

    if (mode === 'tenant') {
      if (form.scopeType === 'UNIT_GROUP') {
        return 'Gasto para un grupo de unidades';
      }

      return 'Gasto común del conjunto';
    }

    if (selectedBuildingName) {
      return `Edificio: ${selectedBuildingName}`;
    }

    return 'Gasto de edificio';
  }, [form.scopeType, isEditMode, mode, selectedBuildingName]);

  const periodSummary = isEditMode
    ? `Período del borrador: ${period}`
    : `Período de registro: ${period}`;

  const clearFieldError = (field: ExpenseFieldKey) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const validateForm = () => {
    const nextErrors: Partial<Record<ExpenseFieldKey, string>> = {};
    const parsedAmount = Number.parseFloat(form.amountMinor);

    if (!form.categoryId.trim()) {
      nextErrors.categoryId = 'Seleccioná un rubro';
    }

    if (!form.amountMinor.trim()) {
      nextErrors.amountMinor = 'Indicá un monto';
    } else if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      nextErrors.amountMinor = 'El monto debe ser mayor que cero';
    }

    if (!form.invoiceDate) {
      nextErrors.invoiceDate = 'Seleccioná la fecha del comprobante';
    }

    if ((form.scopeType === 'BUILDING' || form.scopeType === 'UNIT_GROUP') && !form.buildingId.trim()) {
      nextErrors.buildingId = 'Seleccioná un edificio';
    }

    if (form.scopeType === 'UNIT_GROUP' && !form.unitGroupId.trim()) {
      nextErrors.unitGroupId = 'Seleccioná un grupo de unidades';
    }

    if (!isEditMode && (form.scopeType === 'TENANT_SHARED' || form.scopeType === 'UNIT_GROUP') && allocations.length === 0) {
      nextErrors.allocations = 'Agregá al menos un edificio para el reparto';
    }

    if (!isEditMode && (form.scopeType === 'TENANT_SHARED' || form.scopeType === 'UNIT_GROUP') && totalPercentage !== 100) {
      nextErrors.allocations = `El reparto debe sumar 100% (actualmente ${totalPercentage}%)`;
    }

    if (!isEditMode && new Set(allocations.map((a) => a.buildingId)).size !== allocations.length) {
      nextErrors.allocations = 'No podés repetir el mismo edificio en el reparto';
    }

    if (isAdjustmentMode && !adjustmentReason.trim()) {
      nextErrors.adjustmentReason = 'Indicá el motivo del ajuste';
    }

    setFieldErrors(nextErrors);

    const firstError = Object.values(nextErrors)[0];
    setSubmitError(firstError ?? null);

    return Object.keys(nextErrors).length === 0;
  };

  // Determine catalogScope based on scopeType
  const catalogScope = form.scopeType === 'TENANT_SHARED' ? 'CONDOMINIUM_COMMON' : 'BUILDING';

  // Fetch categories filtered by catalogScope
  const categoriesQuery = useExpenseLedgerCategories(
    tenantId,
    'EXPENSE',
    catalogScope
  );
  const expenseCategories: ExpenseLedgerCategory[] = categoriesQuery.data ?? [];
  const categoriesLoading = categoriesQuery.isPending || categoriesQuery.isFetching;
  const categoriesError = categoriesQuery.isError;
  const categoriesErrorMessage = getReadableErrorMessage(
    categoriesQuery.error,
    'No pudimos cargar los rubros contables.'
  );
  const categoriesEmpty = !categoriesLoading && !categoriesError && expenseCategories.length === 0;

  // Fetch unit groups for UNIT_GROUP scope
  const {
    data: unitGroups = [],
    isLoading: unitGroupsLoading,
    isError: unitGroupsIsError,
    error: unitGroupsError,
    refetch: refetchUnitGroups,
  } = useQuery<UnitGroupOption[]>({
    queryKey: ['unitGroups', tenantId, effectiveBuildingId],
    queryFn: async () => {
      const response = await unitGroupApi.list(tenantId, effectiveBuildingId || undefined);
      if (!isUnitGroupOptionList(response)) {
        throw new Error('La respuesta de grupos de unidades no tiene el formato esperado');
      }
      return response;
    },
    enabled: form.scopeType === 'UNIT_GROUP' && !!tenantId && !!effectiveBuildingId,
    staleTime: 5 * 60 * 1000,
  });
  const unitGroupsReady = form.scopeType !== 'UNIT_GROUP' || !!effectiveBuildingId;
  const unitGroupsErrorMessage = getReadableErrorMessage(
    unitGroupsError,
    'No pudimos cargar los grupos de unidades.'
  );

  const [allocations, setAllocations] = useState<AllocationInput[]>([]);
  const [allocationMode, setAllocationMode] = useState<'manual' | 'm2' | 'equal'>('manual');

  // Fetch allocation suggestions
  const {
    data: suggestions = [],
    isLoading: suggestionsLoading,
    isError: suggestionsIsError,
    error: suggestionsError,
    refetch: refetchSuggestions,
  } = useQuery({
    queryKey: ['allocationSuggestions', tenantId, allocationMode],
    queryFn: () => getAllocationSuggestions(
      tenantId,
      allocationMode === 'm2' ? 'BUILDING_TOTAL_M2' : 'EQUAL_SHARE'
    ),
    enabled: allocationMode !== 'manual' && form.scopeType === 'TENANT_SHARED',
    staleTime: 5 * 60 * 1000,
    retry: false,
    throwOnError: false,
  });
  const suggestionsErrorMessage = getReadableErrorMessage(
    suggestionsError,
    'No pudimos calcular la sugerencia de reparto.'
  );

  // Apply suggestions when mode changes
  useEffect(() => {
    if (suggestions.length > 0 && allocationMode !== 'manual') {
      setAllocations(
        suggestions.map((s: AllocationSuggestion) => ({
          buildingId: s.buildingId,
          percentage: Math.round(s.percentage * 100) / 100,
          currencyCode: form.currencyCode,
        }))
      );
    }
  }, [suggestions, allocationMode, form.currencyCode]);

  // Fetch vendor suggestion when category changes
  const [suggestedVendorInfo, setSuggestedVendorInfo] = useState<SuggestedVendorInfo | null>(null);

  useEffect(() => {
    if (!form.categoryId) {
      setSuggestedVendorInfo(null);
      setSuggestedVendorError(null);
      return;
    }

    if (form.vendorId) return;

    getVendorSuggestion(tenantId, form.categoryId)
      .then((suggestion) => {
        if (suggestion.vendorId && suggestion.vendorName) {
          setSuggestedVendorInfo({
            vendorId: suggestion.vendorId,
            vendorName: suggestion.vendorName,
            source: suggestion.source,
          });
          setSuggestedVendorError(null);
          return;
        }

        setSuggestedVendorInfo(null);
        setSuggestedVendorError(null);
      })
      .catch((error: unknown) => {
        setSuggestedVendorInfo(null);
        setSuggestedVendorError(
          getReadableErrorMessage(error, 'No pudimos sugerir un proveedor para este rubro')
        );
      });
  }, [form.categoryId, form.vendorId, tenantId]);

  // Auto-select suggested vendor if user hasn't selected one
  useEffect(() => {
    if (suggestedVendorInfo && !form.vendorId) {
      setForm((f) => ({ ...f, vendorId: suggestedVendorInfo.vendorId }));
    }
  }, [suggestedVendorInfo, form.vendorId]);

  // Sync currency default once tenant branding loads
  useEffect(() => {
    if (isEditMode) return;
    setForm((f) => ({ ...f, currencyCode: currency }));
  }, [currency, isEditMode]);

  // Set default building when in BUILDING scope
  useEffect(() => {
    if (form.scopeType === 'BUILDING' && initialBuildingId) {
      setForm((f) => ({ ...f, buildingId: initialBuildingId }));
    }
  }, [form.scopeType, initialBuildingId]);

  // Sync form when editing an expense
  useEffect(() => {
    if (!isEditMode || !initialExpense) return;

    setForm({
      categoryId: initialExpense.categoryId,
      vendorId: initialExpense.vendorId ?? '',
      amountMinor: String(initialExpense.amountMinor / 100),
      currencyCode: initialExpense.currencyCode,
      invoiceDate: toInputDate(initialExpense.invoiceDate),
      description: initialExpense.description ?? '',
      scopeType: isExpenseScopeType(initialExpense.scopeType)
        ? initialExpense.scopeType
        : defaultScopeType,
      buildingId: initialExpense.buildingId ?? initialBuildingId ?? '',
      unitGroupId: initialExpense.unitGroupId ?? '',
    });
  }, [defaultScopeType, isEditMode, initialExpense, initialBuildingId]);

  // Clear category when scope changes (invalidates selection)
  useEffect(() => {
    if (isEditMode) return;
    setForm((f) => ({ ...f, categoryId: '' }));
  }, [catalogScope, isEditMode]);

  // Calculate total percentage
  const totalPercentage = useMemo(
    () => allocations.reduce((sum, a) => sum + (a.percentage ?? 0), 0),
    [allocations]
  );

  // Add empty allocation row
  const addAllocation = () => {
    if (buildings.length === 0) return;
    const firstBuilding = buildings[0];
    setAllocations((prev) => [
      ...prev,
      { buildingId: firstBuilding.id, percentage: 0, currencyCode: form.currencyCode },
    ]);
  };

  // Remove allocation row
  const removeAllocation = (index: number) => {
    setAllocations((prev) => prev.filter((_, i) => i !== index));
  };

  // Update allocation
  const updateAllocation = (index: number, field: keyof AllocationInput, value: string | number) => {
    setAllocations((prev) =>
      prev.map((alloc, i) =>
        i === index ? { ...alloc, [field]: value } : alloc
      )
    );
  };

  const handleCountrySearch = async () => {
    const query = countryQuery.trim();
    if (!query) {
      toast('Escribí un criterio de búsqueda', 'error');
      return;
    }

    setCountryLoading(true);
    try {
      const results = await listCountryCatalogVendors(query);
      setCountryCatalogResults(results);
      if (results.length === 0) {
        toast('No encontramos proveedores compartidos para ese criterio', 'error');
      }
    } catch (err: unknown) {
      const msg = getReadableErrorMessage(err, 'Error buscando proveedores compartidos');
      toast(msg, 'error');
    } finally {
      setCountryLoading(false);
    }
  };

  const handleImportCountryVendor = async (sourceVendorId: string) => {
    setImportingVendorId(sourceVendorId);
    try {
      const imported = await importCountryCatalogVendor({
        sourceVendorId,
        assignBuildingId: effectiveBuildingId || undefined,
        serviceType: 'GENERAL',
      });

      await refetchVendors();
      setForm((f) => ({ ...f, vendorId: imported.id }));
      toast('Proveedor importado y seleccionado', 'success');
    } catch (err: unknown) {
      const msg = getReadableErrorMessage(err, 'Error importando proveedor');
      toast(msg, 'error');
    } finally {
      setImportingVendorId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!validateForm()) {
      return;
    }

    if (!confirmSubmit) {
      setSubmitError('Confirmá que revisaste el gasto antes de guardarlo.');
      return;
    }

    const amountMinor = Math.round(parseFloat(form.amountMinor) * 100);

    try {
      // Si está en modo ajuste, crear ajuste en lugar de gasto
      if (isAdjustmentMode) {
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;
        const targetPeriod = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
        
        await createAdjustmentMutation.mutateAsync({
          buildingId: form.buildingId,
          sourceInvoiceDate: form.invoiceDate,
          sourcePeriod: derivedPeriod,
          targetPeriod,
          categoryId: form.categoryId,
          amountMinor,
          currencyCode: form.currencyCode,
          reason: adjustmentReason.trim(),
        });
        toast('Ajuste registrado. Validalo para que se cobre en la próxima liquidación.', 'success');
        onCreated();
        return;
      }

      const expenseData: CreateExpenseData = {
        buildingId: form.scopeType === 'BUILDING' ? form.buildingId : undefined,
        period,
        categoryId: form.categoryId,
        vendorId: form.vendorId || undefined,
        amountMinor,
        currencyCode: form.currencyCode,
        invoiceDate: form.invoiceDate,
        description: form.description.trim() || undefined,
        scopeType: form.scopeType,
        unitGroupId: form.scopeType === 'UNIT_GROUP' ? form.unitGroupId || undefined : undefined,
        allocations: (form.scopeType === 'TENANT_SHARED' || form.scopeType === 'UNIT_GROUP') ? allocations : undefined,
      };

      if (isEditMode && initialExpense) {
        await updateMutation.mutateAsync({
          expenseId: initialExpense.id,
          data: {
            categoryId: expenseData.categoryId,
            vendorId: expenseData.vendorId,
            amountMinor: expenseData.amountMinor,
            currencyCode: expenseData.currencyCode,
            invoiceDate: expenseData.invoiceDate,
            description: expenseData.description,
          },
        });
        toast('Gasto borrador actualizado', 'success');
      } else {
        await createMutation.mutateAsync(expenseData);
        toast('Gasto registrado en borrador', 'success');
      }

      onCreated();
    } catch (err: unknown) {
      // Detectar error de período publicado y ofrecer crear ajuste
      if (
        err instanceof HttpError &&
        err.data?.code === 'PERIOD_PUBLISHED'
      ) {
        toast('El período ya está liquidado. ¿Querés registrarlo como ajuste?', 'error');
        setIsAdjustmentMode(true);
        return;
      }
      
      const msg = getReadableErrorMessage(
        err,
        isEditMode ? 'Error al actualizar el gasto' : 'Error al registrar el gasto'
      );
      setSubmitError(msg);
      toast(msg, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="presentation">
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-create-modal-title"
        aria-describedby="expense-create-modal-description"
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 id="expense-create-modal-title" className="text-lg font-semibold">
              {isEditMode ? 'Editar gasto en borrador' : 'Registrar gasto'}
            </h2>
            <p id="expense-create-modal-description" className="text-xs text-muted-foreground mt-1">
              {scopeSummary}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">
                {periodSummary}
              </span>
              {derivedPeriod && (
                <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">
                  Período de devengo: {derivedPeriod}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal de gasto"
            className="p-1 rounded hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {submitError && (
          <div
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
            aria-live="polite"
          >
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Scope selector - solo en modo tenant (crear) */}
          {mode === 'tenant' && !isEditMode && (
            <div>
              <label htmlFor={expenseFieldIds.scopeType} className="block text-sm font-medium mb-1">
                Alcance <span className="text-red-500">*</span>
              </label>
              <select
                id={expenseFieldIds.scopeType}
                value={form.scopeType}
                onChange={(e) => {
                  const nextScopeType =
                    e.target.value === 'TENANT_SHARED' ||
                    e.target.value === 'UNIT_GROUP' ||
                    e.target.value === 'BUILDING'
                      ? e.target.value
                      : defaultScopeType;

                  setSubmitError(null);
                  setForm((f) => ({
                    ...f,
                    scopeType: nextScopeType,
                    unitGroupId: '',
                  }));
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                aria-describedby="expense-scope-help"
              >
                <option value="TENANT_SHARED">Gasto común del conjunto</option>
                <option value="UNIT_GROUP">Grupo de unidades</option>
              </select>
              <p id="expense-scope-help" className="text-xs text-muted-foreground mt-1">
                {form.scopeType === 'UNIT_GROUP'
                  ? 'El gasto se distribuye entre las unidades del grupo seleccionado'
                  : 'El gasto se distribuye entre los edificios del conjunto'}
              </p>
            </div>
          )}

          {/* Building selector (required for BUILDING and UNIT_GROUP scopes in create mode) */}
          {(form.scopeType === 'BUILDING' || form.scopeType === 'UNIT_GROUP') && !isEditMode && (
            <div>
              <label htmlFor={expenseFieldIds.buildingId} className="block text-sm font-medium mb-1">
                {form.scopeType === 'UNIT_GROUP' ? 'Edificio del grupo' : 'Edificio'} <span className="text-red-500">*</span>
              </label>
              <select
                id={expenseFieldIds.buildingId}
                required
                value={form.buildingId}
                onChange={(e) => {
                  setSubmitError(null);
                  clearFieldError('buildingId');
                  setForm((f) => ({ ...f, buildingId: e.target.value }));
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                aria-invalid={!!fieldErrors.buildingId}
                aria-describedby={fieldErrors.buildingId ? 'expense-building-error' : undefined}
                >
                  <option value="">Seleccioná un edificio</option>
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
              {form.scopeType === 'UNIT_GROUP' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Elegí primero el edificio para cargar sus grupos de unidades
                </p>
              )}
              {fieldErrors.buildingId && (
                <p id="expense-building-error" className="mt-1 text-xs text-red-600">
                  {fieldErrors.buildingId}
                </p>
              )}
            </div>
          )}

          {/* Unit Group selector (only for UNIT_GROUP scope in create mode) */}
          {form.scopeType === 'UNIT_GROUP' && !isEditMode && (
            <div>
              <label htmlFor={expenseFieldIds.unitGroupId} className="block text-sm font-medium mb-1">
                Grupo de unidades <span className="text-red-500">*</span>
              </label>
              <select
                id={expenseFieldIds.unitGroupId}
                required
                value={form.unitGroupId}
                disabled={!unitGroupsReady || unitGroupsLoading}
                onChange={(e) => {
                  setSubmitError(null);
                  clearFieldError('unitGroupId');
                  setForm((f) => ({ ...f, unitGroupId: e.target.value }));
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                aria-invalid={!!fieldErrors.unitGroupId}
                aria-describedby={fieldErrors.unitGroupId ? 'expense-unit-group-error' : 'expense-unit-group-help'}
              >
                <option value="">
                  {!unitGroupsReady
                    ? 'Elegí un edificio primero'
                    : unitGroupsLoading
                      ? 'Cargando...'
                      : 'Seleccioná un grupo'}
                </option>
                {unitGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <p id="expense-unit-group-help" className="mt-1 text-xs text-muted-foreground">
                {!unitGroupsReady
                  ? 'Los grupos de unidades se cargan por edificio'
                  : unitGroupsLoading
                    ? 'Cargando grupos de unidades…'
                    : 'El gasto se prorratea entre las unidades del grupo'}
              </p>
            {unitGroupsIsError && (
                <div className="mt-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  <p>{unitGroupsErrorMessage}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void refetchUnitGroups()}
                    className="mt-2"
                  >
                    Reintentar
                  </Button>
                </div>
              )}
              {unitGroupsReady && !unitGroupsLoading && !unitGroupsIsError && unitGroups.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  No hay grupos de unidades creados para este edificio
                </p>
              )}
              {fieldErrors.unitGroupId && (
                <p id="expense-unit-group-error" className="mt-1 text-xs text-red-600">
                  {fieldErrors.unitGroupId}
                </p>
              )}
            </div>
          )}

          {/* Category selector - EXPENSE only */}
          <div>
            <label htmlFor={expenseFieldIds.categoryId} className="block text-sm font-medium mb-1">
              Rubro <span className="text-red-500">*</span>
            </label>
            <select
              id={expenseFieldIds.categoryId}
              required
              value={form.categoryId}
              onChange={(e) => {
                setSubmitError(null);
                clearFieldError('categoryId');
                setSuggestedVendorInfo(null);
                setSuggestedVendorError(null);
                setForm((f) => ({ ...f, categoryId: e.target.value, vendorId: '' }));
              }}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              aria-invalid={!!fieldErrors.categoryId}
              aria-describedby={fieldErrors.categoryId ? 'expense-category-error' : 'expense-category-help'}
              disabled={categoriesLoading || categoriesError || categoriesEmpty}
            >
              <option value="">Seleccioná un rubro</option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {categoriesLoading && (
              <p className="mt-1 text-xs text-muted-foreground">Cargando rubros…</p>
            )}
            {categoriesError && (
              <div className="mt-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <p>{categoriesErrorMessage}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void categoriesQuery.refetch()}
                  className="mt-2"
                >
                  Reintentar
                </Button>
              </div>
            )}
            {!categoriesLoading && !categoriesError && categoriesEmpty && (
              <p className="mt-1 text-xs text-muted-foreground">
                No hay rubros disponibles para este alcance
              </p>
            )}
            {!categoriesLoading && !categoriesError && !categoriesEmpty && (
              <p id="expense-category-help" className="mt-1 text-xs text-muted-foreground">
                Elegí el rubro contable que mejor describa el gasto
              </p>
            )}
            {fieldErrors.categoryId && (
              <p id="expense-category-error" className="mt-1 text-xs text-red-600">
                {fieldErrors.categoryId}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={expenseFieldIds.amountMinor} className="block text-sm font-medium mb-1">
                Monto <span className="text-red-500">*</span>
              </label>
              <input
                id={expenseFieldIds.amountMinor}
                type="number"
                required
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={form.amountMinor}
                onChange={(e) => {
                  setSubmitError(null);
                  clearFieldError('amountMinor');
                  setForm((f) => ({ ...f, amountMinor: e.target.value }));
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                aria-invalid={!!fieldErrors.amountMinor}
                aria-describedby={fieldErrors.amountMinor ? 'expense-amount-error' : 'expense-amount-help'}
              />
              <p id="expense-amount-help" className="mt-1 text-xs text-muted-foreground">
                Ingresá el monto total del gasto antes de impuestos, si aplica
              </p>
              {fieldErrors.amountMinor && (
                <p id="expense-amount-error" className="mt-1 text-xs text-red-600">
                  {fieldErrors.amountMinor}
                </p>
              )}
            </div>
            <div>
              <p className="block text-sm font-medium mb-1">Moneda</p>
              <div
                id={expenseFieldIds.currencyCode}
                className="w-full rounded-lg border bg-muted/30 px-3 py-2 text-sm font-medium text-foreground"
                aria-describedby="expense-currency-help"
              >
                {form.currencyCode}
              </div>
              <p id="expense-currency-help" className="mt-1 text-xs text-muted-foreground">
                La moneda se toma de la configuración del tenant
              </p>
            </div>
          </div>

          <div>
            <label htmlFor={expenseFieldIds.invoiceDate} className="block text-sm font-medium mb-1">
              Fecha del comprobante <span className="text-red-500">*</span>
            </label>
            <input
              id={expenseFieldIds.invoiceDate}
              type="date"
              required
              value={form.invoiceDate}
              onChange={(e) => {
                setSubmitError(null);
                clearFieldError('invoiceDate');
                setForm((f) => ({ ...f, invoiceDate: e.target.value }));
              }}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              aria-invalid={!!fieldErrors.invoiceDate}
              aria-describedby={fieldErrors.invoiceDate ? 'expense-invoice-date-error' : 'expense-invoice-date-help'}
            />
            <p id="expense-invoice-date-help" className="mt-1 text-xs text-muted-foreground">
              Esta fecha define el período de devengo y el control del comprobante
            </p>
            {fieldErrors.invoiceDate && (
              <p id="expense-invoice-date-error" className="mt-1 text-xs text-red-600">
                {fieldErrors.invoiceDate}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={expenseFieldIds.vendorId} className="block text-sm font-medium mb-1">
              Proveedor
              {suggestedVendorInfo && (
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  (sugerido: {suggestedVendorInfo.vendorName})
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <select
                id={expenseFieldIds.vendorId}
                value={form.vendorId}
                onChange={(e) => {
                  setSubmitError(null);
                  setSuggestedVendorError(null);
                  setForm((f) => ({ ...f, vendorId: e.target.value }));
                }}
                className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={vendorsLoading}
                aria-describedby="expense-vendor-help"
              >
                <option value="">
                  {vendorsLoading ? 'Cargando...' : 'Sin proveedor'}
                </option>
                {allVendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowVendorCreate(true)}
                aria-label="Crear proveedor nuevo"
                title="Crear nuevo proveedor"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p id="expense-vendor-help" className="mt-1 text-xs text-muted-foreground">
              Podés dejarlo vacío si todavía no tenés el proveedor cargado
            </p>
            {vendorsError && (
              <div className="mt-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <p>{vendorsError}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void refetchVendors()}
                  className="mt-2"
                >
                  Reintentar
                </Button>
              </div>
            )}
            {suggestedVendorError && (
              <p className="mt-1 text-xs text-red-600" role="alert">
                {suggestedVendorError}
              </p>
            )}
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Buscar proveedor compartido
            </p>
            <div className="flex gap-2">
              <input
                id={expenseFieldIds.vendorSearch}
                type="text"
                value={countryQuery}
                onChange={(e) => {
                  setSubmitError(null);
                  setCountryQuery(e.target.value);
                  clearFieldError('vendorSearch');
                }}
                placeholder="Nombre o RIF/CUIT"
                className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                aria-describedby="expense-vendor-search-help"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={countryLoading}
                onClick={handleCountrySearch}
              >
                {countryLoading ? 'Buscando...' : 'Buscar'}
              </Button>
            </div>
            <p id="expense-vendor-search-help" className="text-xs text-muted-foreground">
              Buscá un proveedor compartido por nombre o identificación fiscal
            </p>

            {countryCatalogResults.length > 0 && (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {countryCatalogResults.map((item) => (
                  <div
                    key={item.sourceVendorId}
                    className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.sourceTenantName} · {item.countryCode}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={importingVendorId === item.sourceVendorId}
                      onClick={() => handleImportCountryVendor(item.sourceVendorId)}
                    >
                      {importingVendorId === item.sourceVendorId ? 'Importando...' : 'Importar'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label htmlFor={expenseFieldIds.description} className="block text-sm font-medium mb-1">
              Descripción
            </label>
            <input
              id={expenseFieldIds.description}
              type="text"
              placeholder="Ej: Factura Edenor Marzo 2026"
              value={form.description}
              onChange={(e) => {
                setSubmitError(null);
                clearFieldError('description');
                setForm((f) => ({ ...f, description: e.target.value }));
              }}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              aria-describedby="expense-description-help"
            />
            <p id="expense-description-help" className="mt-1 text-xs text-muted-foreground">
              Opcional. Usala para dejar el detalle visible del comprobante
            </p>
          </div>

          {/* Ajuste / Retroactivo UI */}
          {isAdjustmentMode && (
            <div className="border-2 border-amber-500 bg-amber-50 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-5 w-5" />
                <span className="font-medium">Registro como Ajuste</span>
              </div>
              <p className="text-sm text-amber-700">
                El período {derivedPeriod} ya está liquidado. Este gasto se cobrará en el período actual.
              </p>
              <div>
                <label htmlFor={expenseFieldIds.adjustmentReason} className="block text-sm font-medium mb-1 text-amber-800">
                  Motivo del ajuste <span className="text-red-500">*</span>
                </label>
                <textarea
                  id={expenseFieldIds.adjustmentReason}
                  required
                  value={adjustmentReason}
                  onChange={(e) => {
                    setSubmitError(null);
                    clearFieldError('adjustmentReason');
                    setAdjustmentReason(e.target.value);
                  }}
                  placeholder="Ej: Gasto de período anterior no registrado a tiempo"
                  rows={2}
                  className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  aria-invalid={!!fieldErrors.adjustmentReason}
                  aria-describedby={fieldErrors.adjustmentReason ? 'expense-adjustment-error' : 'expense-adjustment-help'}
                />
                <p id="expense-adjustment-help" className="mt-1 text-xs text-amber-700">
                  Este texto queda asociado al ajuste para auditoría y revisión
                </p>
                {fieldErrors.adjustmentReason && (
                  <p id="expense-adjustment-error" className="mt-1 text-xs text-red-700">
                    {fieldErrors.adjustmentReason}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAdjustmentMode(false);
                  setAdjustmentReason('');
                }}
                className="text-sm text-amber-700 hover:underline"
              >
                ← Volver a registrar como gasto normal
              </button>
            </div>
          )}

          {/* Allocations section - for TENANT_SHARED and UNIT_GROUP create mode */}
          {(form.scopeType === 'TENANT_SHARED' || form.scopeType === 'UNIT_GROUP') && !isEditMode && (
            <fieldset className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <legend className="block text-sm font-medium">
                  Reparto a edificios <span className="text-red-500">*</span>
                </legend>
              </div>

              {/* Mode toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAllocationMode('manual')}
                  className={`flex-1 py-2 px-3 text-sm rounded-lg border transition ${
                    allocationMode === 'manual'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => setAllocationMode('m2')}
                  disabled={suggestionsLoading}
                  className={`flex-1 py-2 px-3 text-sm rounded-lg border transition flex items-center justify-center gap-1 ${
                    allocationMode === 'm2'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  <Calculator className="h-4 w-4" />
                  Por m²
                </button>
                <button
                  type="button"
                  onClick={() => setAllocationMode('equal')}
                  disabled={suggestionsLoading}
                  className={`flex-1 py-2 px-3 text-sm rounded-lg border transition flex items-center justify-center gap-1 ${
                    allocationMode === 'equal'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  <Users className="h-4 w-4" />
                  Igualitario
                </button>
              </div>

              {allocationMode === 'manual' && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={addAllocation}
                    disabled={buildingsLoading || buildings.length === 0}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Agregar edificio
                  </Button>

                  {allocations.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Agregá edificios para configurar el reparto
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {allocations.map((alloc, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <select
                            id={`${expenseFieldIds.allocationBuildingPrefix}-${index}`}
                            value={alloc.buildingId}
                            onChange={(e) => {
                              setSubmitError(null);
                              clearFieldError('allocations');
                              updateAllocation(index, 'buildingId', e.target.value);
                            }}
                            className="flex-1 px-2 py-1.5 border rounded text-sm"
                            aria-label={`Edificio del reparto ${index + 1}`}
                          >
                            {buildings.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                          <input
                            id={`${expenseFieldIds.allocationPercentagePrefix}-${index}`}
                            type="number"
                            min="0"
                            max="100"
                            value={alloc.percentage ?? 0}
                            onChange={(e) => {
                              setSubmitError(null);
                              clearFieldError('allocations');
                              updateAllocation(index, 'percentage', parseInt(e.target.value) || 0);
                            }}
                            className="w-20 px-2 py-1.5 border rounded text-sm"
                            placeholder="%"
                            aria-label={`Porcentaje del reparto ${index + 1}`}
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                          <button
                            type="button"
                            onClick={() => removeAllocation(index)}
                            aria-label={`Eliminar edificio ${index + 1} del reparto`}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {allocationMode !== 'manual' && suggestionsLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Calculando...</span>
                </div>
              )}

              {allocationMode !== 'manual' && suggestionsIsError && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <p>{suggestionsErrorMessage}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void refetchSuggestions()}
                    className="mt-2"
                  >
                    Reintentar
                  </Button>
                </div>
              )}

              {allocationMode !== 'manual' && !suggestionsLoading && !suggestionsIsError && suggestions.length > 0 && (
                <div className="space-y-2">
                  {suggestions.map((suggestion: AllocationSuggestion) => (
                    <div
                      key={suggestion.buildingId}
                      className="flex items-center justify-between p-2 bg-muted/30 rounded text-sm"
                    >
                      <span className="font-medium">{suggestion.buildingName}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs">
                          {suggestion.totalM2.toLocaleString()} m²
                        </span>
                        <span className="font-semibold">
                          {suggestion.percentage.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {allocationMode !== 'manual' && !suggestionsLoading && !suggestionsIsError && suggestions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No hay sugerencias disponibles para este modo de reparto
                </p>
              )}

              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">Total:</span>
                <span
                  className={
                    totalPercentage === 100
                      ? 'text-green-600 font-medium'
                      : 'text-red-600 font-medium'
                  }
                >
                  {totalPercentage.toFixed(2)}%
                </span>
              </div>

              {totalPercentage !== 100 && allocationMode === 'manual' && (
                <p className="text-xs text-red-500">
                  El porcentaje debe sumar 100%
                </p>
              )}
              {fieldErrors.allocations && (
                <p className="text-xs text-red-600" role="alert">
                  {fieldErrors.allocations}
                </p>
              )}
            </fieldset>
          )}

          <p className="text-xs text-muted-foreground">
            {isEditMode
              ? 'Solo podés editar gastos en borrador. Guardá cambios y luego validá.'
              : 'El gasto queda en borrador. Los cargos y la deuda se generan al publicar la liquidación.'}
          </p>

          <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={confirmSubmit}
              onChange={(e) => {
                setSubmitError(null);
                setConfirmSubmit(e.target.checked);
              }}
              className="mt-1 h-4 w-4 rounded border-amber-400"
            />
            <span>Confirmo que revisé el gasto y quiero guardar este movimiento financiero.</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                createMutation.isPending ||
                updateMutation.isPending ||
                createAdjustmentMutation.isPending ||
                !confirmSubmit
              }
            >
              {(createMutation.isPending || updateMutation.isPending || createAdjustmentMutation.isPending) && (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              )}
              {isEditMode ? 'Guardar cambios' : isAdjustmentMode ? 'Registrar ajuste' : 'Registrar gasto'}
            </Button>
          </div>
        </form>
      </div>

      {showVendorCreate && (
        <VendorCreateModal
          buildingId={effectiveBuildingId || undefined}
          onSave={async (createdVendorId) => {
            await refetchVendors();
            if (createdVendorId) {
              setForm((f) => ({ ...f, vendorId: createdVendorId }));
            }
            setShowVendorCreate(false);
          }}
          onClose={() => setShowVendorCreate(false)}
        />
      )}
    </div>
  );
}
