'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CANONICAL_CURRENCIES } from '@buildingos/contracts';
import { Loader2, X } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import { useBuildings } from '@/features/buildings/hooks';
import { useToast } from '@/shared/components/ui/Toast';
import { useCreateIncome, useExpenseLedgerCategories } from '../hooks/useExpenseLedger';
import { useFinanceSettings } from '../hooks/useFinanceSettings';
import { financeKeys } from '../hooks/finance-query-keys';
import { unitGroupApi } from '../services/liquidation.api';
import type { IncomeScopeType, MovementAllocationInput } from '../contracts';
import { decimalToAmountMinor, sumAmountMinor } from '../utils/money-input';
import { resolveDefaultCurrency } from '../utils/currency-default';
import { todayLocalDate } from '../utils/date-input';

interface IncomeCreateModalProps {
  tenantId: string;
  buildingId?: string;
  period: string;
  onClose: () => void;
  onCreated: () => void;
}

interface AllocationDraft {
  buildingId: string;
  amount: string;
}

export function IncomeCreateModal({ tenantId, buildingId, period, onClose, onCreated }: IncomeCreateModalProps) {
  const { toast } = useToast();
  const { buildings, loading: buildingsLoading } = useBuildings(tenantId);
  const { data: categories = [], isLoading: categoriesLoading } = useExpenseLedgerCategories(tenantId);
  const { data: financeSettings } = useFinanceSettings(tenantId);
  const createMutation = useCreateIncome(tenantId);
  const [scopeType, setScopeType] = useState<IncomeScopeType>('BUILDING');
  const [selectedBuildingId, setSelectedBuildingId] = useState(buildingId ?? '');
  const [unitGroupId, setUnitGroupId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [explicitCurrency, setExplicitCurrency] = useState<string | null>(null);
  const currencyCode = explicitCurrency ?? resolveDefaultCurrency(financeSettings?.functionalCurrency, CANONICAL_CURRENCIES);
  const [receivedDate, setReceivedDate] = useState(() => todayLocalDate());
  const [description, setDescription] = useState('');
  const [allocationDrafts, setAllocationDrafts] = useState<AllocationDraft[]>([]);

  const groupsQuery = useQuery({
    queryKey: financeKeys.unitGroups(tenantId, selectedBuildingId),
    queryFn: () => unitGroupApi.list(tenantId, selectedBuildingId),
    enabled: scopeType === 'UNIT_GROUP' && Boolean(selectedBuildingId),
  });
  const incomeCategories = categories.filter((category) => category.movementType === 'INCOME' && category.isActive);
  const amountMinor = decimalToAmountMinor(amount);

  const syncAllocations = () => {
    setAllocationDrafts(buildings.map((building) => ({ buildingId: building.id, amount: '' })));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!amountMinor) return toast('Ingresá un monto positivo con hasta dos decimales.', 'error');
    if (!categoryId) return toast('Seleccioná un rubro de ingreso.', 'error');
    if (scopeType === 'BUILDING' && !selectedBuildingId) return toast('Seleccioná un edificio.', 'error');
    if (scopeType === 'UNIT_GROUP' && (!selectedBuildingId || !unitGroupId)) return toast('Seleccioná el edificio y grupo de unidades.', 'error');

    let allocations: MovementAllocationInput[] | undefined;
    if (scopeType !== 'BUILDING') {
      const parsed = allocationDrafts.map((allocation) => ({
        buildingId: allocation.buildingId,
        amountMinor: decimalToAmountMinor(allocation.amount),
      }));
      if (parsed.length === 0 || parsed.some((allocation) => !allocation.amountMinor)) {
        return toast('Asigná un importe positivo a cada edificio incluido.', 'error');
      }
      const total = sumAmountMinor(parsed.map((allocation) => allocation.amountMinor!));
      if (total !== amountMinor) return toast('La suma de asignaciones debe coincidir exactamente con el ingreso.', 'error');
      allocations = parsed.map((allocation) => ({ ...allocation, amountMinor: allocation.amountMinor!, currencyCode }));
    }

    try {
      await createMutation.mutateAsync({
        period,
        categoryId,
        amountMinor,
        currencyCode,
        receivedDate,
        description: description.trim() || undefined,
        scopeType,
        buildingId: scopeType === 'BUILDING' ? selectedBuildingId : undefined,
        unitGroupId: scopeType === 'UNIT_GROUP' ? unitGroupId : undefined,
        allocations,
      });
      toast('Ingreso creado como borrador.', 'success');
      onCreated();
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No pudimos crear el ingreso.', 'error');
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="income-create-title">
    <div className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-background p-6 shadow-xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h2 id="income-create-title" className="text-lg font-semibold">Registrar ingreso</h2><p className="text-sm text-muted-foreground">El plan de aplicaciones define el uso financiero final.</p></div>
        <button type="button" onClick={onClose} aria-label="Cerrar diálogo de ingreso" className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Rubro<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Seleccioná un rubro</option>{incomeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="text-sm font-medium">Período<input required type="month" value={period} readOnly className="mt-1 w-full rounded border bg-muted p-2" /></label>
          <label className="text-sm font-medium">Monto<input required inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
          <label className="text-sm font-medium">Moneda<select value={currencyCode} onChange={(event) => setExplicitCurrency(event.target.value)} className="mt-1 w-full rounded border p-2">{CANONICAL_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
          <label className="text-sm font-medium">Fecha recibida<input required type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
          <label className="text-sm font-medium">Alcance<select value={scopeType} onChange={(event) => { const next = event.target.value as IncomeScopeType; setScopeType(next); setUnitGroupId(''); if (next !== 'BUILDING') syncAllocations(); }} className="mt-1 w-full rounded border p-2"><option value="BUILDING">Edificio</option><option value="TENANT_SHARED">Compartido del conjunto</option><option value="UNIT_GROUP">Grupo de unidades</option></select></label>
        </div>
        <p className="text-xs text-muted-foreground">Moneda funcional: {financeSettings?.functionalCurrency ?? 'cargando'}. Es contexto contable, no una lista de monedas permitidas.</p>
        <label className="block text-sm font-medium">Edificio<select required={scopeType !== 'TENANT_SHARED'} value={selectedBuildingId} onChange={(event) => { setSelectedBuildingId(event.target.value); setUnitGroupId(''); }} className="mt-1 w-full rounded border p-2"><option value="">{scopeType === 'TENANT_SHARED' ? 'No aplica al ingreso compartido' : 'Seleccioná un edificio'}</option>{buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label>
        {scopeType === 'UNIT_GROUP' && <label className="block text-sm font-medium">Grupo de unidades<select required value={unitGroupId} onChange={(event) => setUnitGroupId(event.target.value)} className="mt-1 w-full rounded border p-2" disabled={groupsQuery.isLoading || !selectedBuildingId}><option value="">{groupsQuery.isLoading ? 'Cargando grupos...' : 'Seleccioná un grupo'}</option>{groupsQuery.data?.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.memberCount} unidades)</option>)}</select>{groupsQuery.error && <span className="text-xs text-red-700">No pudimos cargar grupos: {groupsQuery.error instanceof Error ? groupsQuery.error.message : 'Error desconocido'}</span>}</label>}
        {scopeType !== 'BUILDING' && <div className="rounded border p-3"><div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium">Asignaciones por edificio</p><Button type="button" variant="secondary" size="sm" onClick={syncAllocations}>Cargar edificios</Button></div>{allocationDrafts.length === 0 ? <p className="text-sm text-muted-foreground">Cargá los edificios para asignar importes exactos.</p> : <div className="space-y-2">{allocationDrafts.map((allocation, index) => <label key={allocation.buildingId} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{buildings.find((building) => building.id === allocation.buildingId)?.name ?? allocation.buildingId}</span><input inputMode="decimal" placeholder="0.00" value={allocation.amount} onChange={(event) => setAllocationDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} className="w-28 rounded border p-2" /></label>)}</div>}</div>}
        <label className="block text-sm font-medium">Descripción<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1 w-full rounded border p-2" /></label>
        {(categoriesLoading || buildingsLoading) && <p className="text-sm text-muted-foreground">Cargando datos del formulario...</p>}
        {createMutation.error && <p className="text-sm text-red-700">{createMutation.error.message}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Crear borrador</Button></div>
      </form>
    </div>
  </div>;
}
