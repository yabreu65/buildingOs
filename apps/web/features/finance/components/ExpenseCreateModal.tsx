'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, Plus, Trash2, Calculator, Users, AlertTriangle } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
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
import type {
  CreateExpenseData,
  ExpenseScopeType,
  AllocationInput,
  AllocationSuggestion,
  CatalogScope,
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

const CURRENCIES = ['ARS', 'VES', 'USD'];

function toInputDate(value: string): string {
  if (!value) return value;
  return value.includes('T') ? value.slice(0, 10) : value;
}

export function ExpenseCreateModal({
  tenantId,
  buildingId: initialBuildingId,
  period,
  onClose,
  onCreated,
  mode = 'building',
  modeForm = 'create',
  initialExpense,
}: ExpenseCreateModalProps) {
  const { toast } = useToast();
  const { currency } = useTenantCurrency();
  const { buildings, loading: buildingsLoading } = useBuildings(tenantId);
  const createMutation = useCreateExpense(tenantId);
  const updateMutation = useUpdateExpense(tenantId);

  const isEditMode = modeForm === 'edit' && !!initialExpense;

  const [form, setForm] = useState({
    categoryId: initialExpense?.categoryId ?? '',
    vendorId: initialExpense?.vendorId ?? '',
    amountMinor: initialExpense ? String(initialExpense.amountMinor / 100) : '',
    currencyCode: initialExpense?.currencyCode ?? 'ARS',
    invoiceDate: initialExpense
      ? toInputDate(initialExpense.invoiceDate)
      : (() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })(),
    description: initialExpense?.description ?? '',
    scopeType:
      (initialExpense?.scopeType as ExpenseScopeType | undefined) ??
      (mode === 'tenant' ? 'TENANT_SHARED' : ('BUILDING' as ExpenseScopeType)),
    buildingId: initialExpense?.buildingId ?? initialBuildingId ?? '',
  });

  const [showVendorCreate, setShowVendorCreate] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');
  const [countryLoading, setCountryLoading] = useState(false);
  const [countryCatalogResults, setCountryCatalogResults] = useState<CountryCatalogVendor[]>([]);
  const [importingVendorId, setImportingVendorId] = useState<string | null>(null);
  const effectiveBuildingId = form.buildingId || initialBuildingId || '';
  const {
    allVendors,
    loading: vendorsLoading,
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

  // Determine catalogScope based on scopeType
  const catalogScope = form.scopeType === 'TENANT_SHARED' ? 'CONDOMINIUM_COMMON' : 'BUILDING';

  // Fetch categories filtered by catalogScope
  const { data: categories = [] } = useExpenseLedgerCategories(
    tenantId,
    'EXPENSE',
    catalogScope
  );

  const [allocations, setAllocations] = useState<AllocationInput[]>([]);
  const [allocationMode, setAllocationMode] = useState<'manual' | 'm2' | 'equal'>('manual');

  // Fetch allocation suggestions
  const { data: suggestions = [], isLoading: suggestionsLoading } = useQuery({
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
  const [suggestedVendorInfo, setSuggestedVendorInfo] = useState<{
    vendorId: string;
    vendorName: string;
    source: VendorSuggestion['source'];
  } | null>(null);

  useEffect(() => {
    if (!form.categoryId) {
      setSuggestedVendorInfo(null);
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
          return;
        }

        setSuggestedVendorInfo(null);
      })
      .catch(() => {
        setSuggestedVendorInfo(null);
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
      scopeType: initialExpense.scopeType as ExpenseScopeType,
      buildingId: initialExpense.buildingId ?? initialBuildingId ?? '',
    });
  }, [isEditMode, initialExpense, initialBuildingId]);

  // Clear category when scope changes (invalidates selection)
  useEffect(() => {
    if (isEditMode) return;
    setForm((f) => ({ ...f, categoryId: '' }));
  }, [catalogScope, isEditMode]);

  // Categories are already filtered by useExpenseLedgerCategories call above
  const expenseCategories = categories;

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
    setCountryLoading(true);
    try {
      const results = await listCountryCatalogVendors(countryQuery);
      setCountryCatalogResults(results);
      if (results.length === 0) {
        toast('No encontramos proveedores compartidos para ese criterio', 'error');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error buscando proveedores por país';
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
      const msg = err instanceof Error ? err.message : 'Error importando proveedor';
      toast(msg, 'error');
    } finally {
      setImportingVendorId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const amountMinor = Math.round(parseFloat(form.amountMinor) * 100);
    if (isNaN(amountMinor) || amountMinor <= 0) {
      toast('El monto debe ser un número positivo', 'error');
      return;
    }

    // Validate allocations if TENANT_SHARED (create mode only)
    if (!isEditMode && form.scopeType === 'TENANT_SHARED' && allocations.length === 0) {
      toast('Debes agregar al menos un edificio para el reparto', 'error');
      return;
    }

    if (!isEditMode && form.scopeType === 'TENANT_SHARED' && totalPercentage !== 100) {
      toast(`El porcentaje total debe ser 100% (actualmente ${totalPercentage}%)`, 'error');
      return;
    }

    // Check for duplicate buildings
    const buildingIds = allocations.map((a) => a.buildingId);
    if (!isEditMode && new Set(buildingIds).size !== buildingIds.length) {
      toast('No puedes seleccionar el mismo edificio dos veces', 'error');
      return;
    }

    try {
      // Si está en modo ajuste, crear ajuste en lugar de gasto
      if (isAdjustmentMode) {
        if (!adjustmentReason.trim()) {
          toast('Debés especificar el motivo del ajuste', 'error');
          return;
        }
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
          reason: adjustmentReason,
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
        description: form.description || undefined,
        scopeType: form.scopeType,
        allocations: form.scopeType === 'TENANT_SHARED' ? allocations : undefined,
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
        toast('Gasto registrado en DRAFT', 'success');
      }

      onCreated();
    } catch (err: unknown) {
      // Detectar error de período publicado y ofrecer crear ajuste
      if (
        err instanceof Error &&
        err.message.includes('PERIOD_PUBLISHED')
      ) {
        toast('El período ya está liquidado. ¿Querés registrarlo como ajuste?', 'error');
        setIsAdjustmentMode(true);
        return;
      }
      
      const msg =
        err instanceof Error
          ? err.message
          : isEditMode
            ? 'Error al actualizar el gasto'
            : 'Error al crear el gasto';
      toast(msg, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">
              {isEditMode ? 'Editar gasto en borrador' : 'Registrar gasto'}
            </h2>
            {derivedPeriod && !isEditMode && (
              <p className="text-xs text-muted-foreground">
                Período de devengo: <span className="font-medium">{derivedPeriod}</span>
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Scope selector - solo en modo tenant (crear) */}
          {mode === 'tenant' && !isEditMode && (
            <div>
              <label className="block text-sm font-medium mb-1">
                Alcance <span className="text-red-500">*</span>
              </label>
              <select
                value={form.scopeType}
                onChange={(e) =>
                  setForm((f) => ({ ...f, scopeType: e.target.value as ExpenseScopeType }))
                }
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="TENANT_SHARED">Gasto común del conjunto</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                El gasto se distribuye entre los edificios del conjunto
              </p>
            </div>
          )}

          {/* Building selector (only for BUILDING scope in create mode) */}
          {form.scopeType === 'BUILDING' && !isEditMode && (
            <div>
              <label className="block text-sm font-medium mb-1">
                Edificio <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={form.buildingId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, buildingId: e.target.value }))
                }
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Seleccioná un edificio</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Category selector - EXPENSE only */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Rubro <span className="text-red-500">*</span>
            </label>
              <select
                required
                value={form.categoryId}
                onChange={(e) => {
                  setSuggestedVendorInfo(null);
                  setForm((f) => ({ ...f, categoryId: e.target.value, vendorId: '' }));
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
              <option value="">Seleccioná un rubro</option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                Monto <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={form.amountMinor}
                onChange={(e) =>
                  setForm((f) => ({ ...f, amountMinor: e.target.value }))
                }
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Moneda</label>
              <select
                value={form.currencyCode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, currencyCode: e.target.value }))
                }
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Fecha del comprobante <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              value={form.invoiceDate}
              onChange={(e) =>
                setForm((f) => ({ ...f, invoiceDate: e.target.value }))
              }
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Proveedor
              {suggestedVendorInfo && (
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  (sugerido: {suggestedVendorInfo.vendorName})
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <select
                value={form.vendorId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, vendorId: e.target.value }))
                }
                className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={vendorsLoading}
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
                title="Crear nuevo proveedor"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Buscar proveedor compartido (mismo país: VE/AR)
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={countryQuery}
                onChange={(e) => setCountryQuery(e.target.value)}
                placeholder="Nombre o RIF/CUIT"
                className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
            <label className="block text-sm font-medium mb-1">
              Descripción
            </label>
            <input
              type="text"
              placeholder="Ej: Factura Edenor Marzo 2026"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
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
                <label className="block text-sm font-medium mb-1 text-amber-800">
                  Motivo del ajuste <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="Ej: Gasto de período anterior no registrado a tiempo"
                  rows={2}
                  className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
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

          {/* Allocations section - only for TENANT_SHARED create mode */}
          {form.scopeType === 'TENANT_SHARED' && !isEditMode && (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium">
                  Reparto a edificios <span className="text-red-500">*</span>
                </label>
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
                            value={alloc.buildingId}
                            onChange={(e) =>
                              updateAllocation(index, 'buildingId', e.target.value)
                            }
                            className="flex-1 px-2 py-1.5 border rounded text-sm"
                          >
                            {buildings.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={alloc.percentage ?? 0}
                            onChange={(e) =>
                              updateAllocation(index, 'percentage', parseInt(e.target.value) || 0)
                            }
                            className="w-20 px-2 py-1.5 border rounded text-sm"
                            placeholder="%"
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                          <button
                            type="button"
                            onClick={() => removeAllocation(index)}
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

              {allocationMode !== 'manual' && !suggestionsLoading && suggestions.length > 0 && (
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
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {isEditMode
              ? 'Solo podés editar gastos en DRAFT. Guardá cambios y luego validá.'
              : 'El gasto se crea en DRAFT. Validalo para que cuente en la liquidación.'}
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending || createAdjustmentMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending || createAdjustmentMutation.isPending) && (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              )}
              {isEditMode ? 'Guardar cambios' : isAdjustmentMode ? 'Registrar Ajuste' : 'Registrar'}
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
