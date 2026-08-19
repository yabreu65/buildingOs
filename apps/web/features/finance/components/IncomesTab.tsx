'use client';

import { useState } from 'react';
import { Loader2, Plus, Save, X } from 'lucide-react';
import { CANONICAL_CURRENCIES } from '@buildingos/contracts';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { formatCurrency } from '@/shared/lib/format/money';
import { useExpenseLedgerCategories, useIncomes, useRecordIncome, useUpdateIncome, useVoidIncome } from '../hooks/useExpenseLedger';
import { useApplyIncomePolicy, useCreateIncomeApplicationPlan, useIncomeApplicationPlan } from '../hooks/useIncomeApplications';
import { useFunds } from '../hooks/useFunds';
import { useHasAnyRoleInTenant } from '@/features/tenancy/hooks/useEffectiveRole';
import type { CreateIncomeApplicationInput, Income, IncomeApplication, IncomeApplicationDestination, UpdateIncomeData } from '../contracts';
import { FinanceDialog } from './FinanceDialog';
import { IncomeCreateModal } from './IncomeCreateModal';
import { LegacyBackfillPanel } from './LegacyBackfillPanel';
import { decimalToAmountMinor, minorToDecimalString, sumAmountMinor } from '../utils/money-input';
import { incomeApplicationProvenance, type IncomeApplicationProvenanceOrigin } from '../utils/income-application-provenance';
import { sameDateInput, toDateInputValue } from '../utils/date-input';

interface IncomesTabProps {
  readonly tenantId: string;
  readonly period: string;
}

interface ApplicationDraft {
  readonly id: string;
  destinationType: IncomeApplicationDestination;
  fundId: string;
  amount: string;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function IncomesTab({ tenantId, period }: IncomesTabProps) {
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'ALL' | Income['status']>('ALL');
  const [showCreate, setShowCreate] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [planIncome, setPlanIncome] = useState<Income | null>(null);
  // FIN-07CR2: el backfill legacy exige TENANT_OWNER/TENANT_ADMIN con alcance
  // de inquilino. `useHasAnyRoleInTenant` consulta `membership.roles`, que el
  // backend construye SOLO con roles scopeType=TENANT: un OPERATOR o un admin
  // con alcance BUILDING/UNIT no califican. Fail-closed: sin sesión/rol -> oculto.
  const canUseLegacyBackfill = useHasAnyRoleInTenant(tenantId, ['TENANT_OWNER', 'TENANT_ADMIN']);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ income: Income; action: 'record' | 'void' } | null>(null);
  const { data: incomes = [], isPending, error } = useIncomes(tenantId, { period, categoryId: categoryId || undefined });
  const { data: categories = [] } = useExpenseLedgerCategories(tenantId, 'INCOME');
  const { data: funds = [] } = useFunds(tenantId, { status: 'ACTIVE' });
  const recordIncome = useRecordIncome(tenantId);
  const voidIncome = useVoidIncome(tenantId);
  const updateIncome = useUpdateIncome(tenantId);

  const visibleIncomes = incomes.filter((income) => status === 'ALL' || income.status === status);
  const runConfirmation = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction.action === 'record') await recordIncome.mutateAsync(confirmAction.income.id);
      else await voidIncome.mutateAsync(confirmAction.income.id);
      setConfirmAction(null);
    } catch {
      // Mutation error stays visible in the confirmation dialog.
    }
  };
  const confirmationMutation = confirmAction?.action === 'record' ? recordIncome : voidIncome;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Ingresos</h3>
          <p className="text-sm text-muted-foreground">Los borradores se registran antes de definir un plan de aplicaciones inmutable.</p>
        </div>
        <div className="flex gap-2">
          {canUseLegacyBackfill && (
            <Button type="button" variant="secondary" onClick={() => setShowBackfill((v) => !v)} className="gap-2" aria-expanded={showBackfill}>
              {showBackfill ? 'Ocultar migración histórica' : 'Migración histórica'}
            </Button>
          )}
          <Button type="button" onClick={() => setShowCreate(true)} className="gap-2"><Plus className="h-4 w-4" />Registrar ingreso</Button>
        </div>
      </div>
      {canUseLegacyBackfill && showBackfill && <LegacyBackfillPanel tenantId={tenantId} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Rubro
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1 w-full rounded border p-2">
            <option value="">Todos los rubros</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Estado
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="mt-1 w-full rounded border p-2">
            <option value="ALL">Todos</option><option value="DRAFT">Borrador</option><option value="RECORDED">Registrado</option><option value="VOID">Anulado</option>
          </select>
        </label>
      </div>
      {isPending ? <Card className="p-6 text-sm text-muted-foreground">Cargando ingresos...</Card> : error ? <Card className="p-6 text-sm text-red-700">{errorMessage(error, 'No pudimos cargar los ingresos.')}</Card> : visibleIncomes.length === 0 ? <Card className="p-6 text-center text-sm text-muted-foreground">No hay ingresos para los filtros seleccionados.</Card> : (
        <div className="space-y-3">
          {visibleIncomes.map((income) => <Card key={income.id} className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="font-medium">{income.categoryName}</p>
                <p className="text-sm text-muted-foreground">{formatCurrency(income.amountMinor, income.currencyCode)} · {toDateInputValue(income.receivedDate)} · {income.scopeType}</p>
                {income.description && <p className="text-sm text-muted-foreground">{income.description}</p>}
                <span className="inline-flex rounded bg-muted px-2 py-0.5 text-xs font-medium">{income.status}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setPlanIncome(income)}>Plan</Button>
                {income.status === 'DRAFT' && <Button type="button" size="sm" variant="secondary" onClick={() => setEditingIncome(income)}>Editar</Button>}
                {income.status === 'DRAFT' && <Button type="button" size="sm" onClick={() => setConfirmAction({ income, action: 'record' })}>Registrar</Button>}
                {income.status === 'RECORDED' && <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmAction({ income, action: 'void' })}>Anular</Button>}
              </div>
            </div>
          </Card>)}
        </div>
      )}
      {showCreate && <IncomeCreateModal tenantId={tenantId} period={period} onClose={() => setShowCreate(false)} onCreated={() => setShowCreate(false)} />}
      {planIncome && <IncomePlanDialog tenantId={tenantId} income={planIncome} funds={funds} onClose={() => setPlanIncome(null)} />}
      {editingIncome && <IncomeEditDialog income={editingIncome} categories={categories} updateIncome={updateIncome} onClose={() => setEditingIncome(null)} />}
      {confirmAction && <FinanceDialog title={confirmAction.action === 'record' ? 'Registrar ingreso' : 'Anular ingreso'} labelledBy="income-confirm-title" onClose={() => setConfirmAction(null)}>
        <p className="text-sm text-muted-foreground">{confirmAction.action === 'record' ? 'Esta acción confirma el ingreso y no permitirá editarlo.' : 'Esta acción anula el ingreso registrado. Confirmá que querés continuar.'}</p>
        {confirmationMutation.error && <p role="alert" className="mt-3 text-sm text-red-700">{errorMessage(confirmationMutation.error, 'No pudimos completar la acción.')}</p>}
        <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setConfirmAction(null)}>Cancelar</Button><Button type="button" disabled={confirmationMutation.isPending} onClick={() => void runConfirmation()}>{confirmationMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Confirmar</Button></div>
      </FinanceDialog>}
    </div>
  );
}

function IncomePlanDialog({ tenantId, income, funds, onClose }: { readonly tenantId: string; readonly income: Income; readonly funds: readonly { id: string; name: string }[]; readonly onClose: () => void }) {
  const { data: plan, isPending, error } = useIncomeApplicationPlan(tenantId, income.id);
  const applyPolicy = useApplyIncomePolicy(tenantId, income.id);
  const createPlan = useCreateIncomeApplicationPlan(tenantId, income.id);
  const [drafts, setDrafts] = useState<ApplicationDraft[]>([{ id: 'first', destinationType: 'OFFSET_EXPENSES', fundId: '', amount: '' }]);
  const [formError, setFormError] = useState<string | null>(null);
  const applications = plan?.applications ?? [];
  const hasApplications = applications.length > 0;
  const planNotApplicable = income.status === 'VOID' && !hasApplications;
  const readonly = hasApplications;
  const cannotCreatePlan = income.status !== 'RECORDED';
  const updateDraft = (id: string, field: keyof Omit<ApplicationDraft, 'id'>, value: string) => setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, [field]: value } : draft));
  const submitManualPlan = async () => {
    const applications: CreateIncomeApplicationInput[] = [];
    for (const draft of drafts) {
      const amountMinor = decimalToAmountMinor(draft.amount);
      if (!amountMinor) return setFormError('Cada aplicación debe tener un importe positivo con hasta dos decimales.');
      if (draft.destinationType === 'FUND' && !draft.fundId) return setFormError('Las aplicaciones a fondo requieren seleccionar un fondo activo.');
      applications.push({ destinationType: draft.destinationType, fundId: draft.destinationType === 'FUND' ? draft.fundId : null, amountMinor });
    }
    if (sumAmountMinor(applications.map((application) => application.amountMinor)) !== income.amountMinor) return setFormError('La suma debe coincidir exactamente con el importe del ingreso, sin redondeos.');
    setFormError(null);
    try { await createPlan.mutateAsync({ applications }); } catch { /* mutation error is rendered below */ }
  };

  return <FinanceDialog title={`Plan de aplicaciones: ${income.categoryName}`} labelledBy="income-plan-title" onClose={onClose}>
    <p className="mb-4 text-sm text-muted-foreground">Total: {formatCurrency(income.amountMinor, income.currencyCode)} ({income.amountMinor} unidades menores).</p>
    {isPending ? <p className="text-sm text-muted-foreground">Cargando plan...</p> : error ? <p role="alert" className="text-sm text-red-700">{errorMessage(error, 'No pudimos cargar el plan.')}</p> : readonly ? <div className="space-y-2"><p className="text-sm font-medium">Plan aplicado. Solo lectura.</p>{applications.map((application) => <ApplicationRow key={application.id} application={application} funds={funds} />)}</div> : planNotApplicable ? <p className="text-sm text-muted-foreground">Este ingreso está anulado y no tiene plan de aplicaciones.</p> : cannotCreatePlan ? <p className="text-sm text-muted-foreground">Registrá este ingreso antes de definir su plan de aplicaciones.</p> : (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Aplicá una política vigente o definí un plan manual. Los importes se convierten a unidades menores de forma exacta.</p>
        <Button type="button" variant="secondary" disabled={applyPolicy.isPending} onClick={() => void applyPolicy.mutateAsync().catch(() => undefined)}>{applyPolicy.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Aplicar política</Button>
        {applyPolicy.error && <p role="alert" className="text-sm text-red-700">{errorMessage(applyPolicy.error, 'No pudimos aplicar la política.')}</p>}
        <div className="space-y-2 rounded border p-3">{drafts.map((draft) => <div key={draft.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_140px_auto]"><select aria-label="Destino" value={draft.destinationType} onChange={(event) => updateDraft(draft.id, 'destinationType', event.target.value)} className="rounded border p-2"><option value="OFFSET_EXPENSES">Compensar gastos</option><option value="FUND">Fondo</option><option value="CARRY_FORWARD">Arrastre</option></select>{draft.destinationType === 'FUND' ? <select aria-label="Fondo" value={draft.fundId} onChange={(event) => updateDraft(draft.id, 'fundId', event.target.value)} className="rounded border p-2"><option value="">Seleccioná un fondo</option>{funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select> : <span className="hidden sm:block" />}<input aria-label="Importe" inputMode="decimal" value={draft.amount} onChange={(event) => updateDraft(draft.id, 'amount', event.target.value)} placeholder="0.00" className="rounded border p-2" /><Button type="button" variant="secondary" size="sm" disabled={drafts.length === 1} onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}>Quitar</Button></div>)}<div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="secondary" size="sm" onClick={() => setDrafts((current) => [...current, { id: String(Date.now()), destinationType: 'OFFSET_EXPENSES', fundId: '', amount: '' }])}>Agregar destino</Button><Button type="button" disabled={createPlan.isPending} onClick={() => void submitManualPlan()}>{createPlan.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Guardar plan manual</Button></div></div>
        {(formError || createPlan.error) && <p role="alert" className="text-sm text-red-700">{formError ?? errorMessage(createPlan.error, 'No pudimos guardar el plan.')}</p>}
      </div>
    )}
  </FinanceDialog>;
}

function provenanceOriginLabel(origin: IncomeApplicationProvenanceOrigin | null): string {
  switch (origin) {
    case 'MANUAL': return 'Origen: Manual';
    case 'POLICY': return 'Origen: Política';
    case 'LEGACY': return 'Origen: Legacy';
    default: return 'Origen: Desconocido';
  }
}

function ApplicationRow({ application, funds }: { readonly application: IncomeApplication; readonly funds: readonly { id: string; name: string }[] }) {
  const provenance = incomeApplicationProvenance(application);
  return <div className="rounded border p-3 text-sm space-y-1">
    <div className="flex flex-wrap items-center gap-x-2"><span className="font-medium">{application.destinationType}</span> · {formatCurrency(application.amountMinor, application.currencyCode)}{application.fundId ? ` · Fondo ${funds.find((fund) => fund.id === application.fundId)?.name ?? application.fundId}` : ''}</div>
    <p className={provenance.origin === 'INVALID' ? 'text-red-700' : 'text-muted-foreground'}>
      {provenanceOriginLabel(provenance.origin)}
      {provenance.origin === 'POLICY' && provenance.policyVersionId ? ` · Versión ${provenance.policyVersionId}` : ''}
      {provenance.origin === 'LEGACY' && provenance.legacyDestination ? ` · Destino legado ${provenance.legacyDestination}` : ''}
    </p>
  </div>;
}

function IncomeEditDialog({ income, categories, updateIncome, onClose }: {
  readonly income: Income;
  readonly categories: readonly { id: string; name: string }[];
  readonly updateIncome: ReturnType<typeof useUpdateIncome>;
  readonly onClose: () => void;
}) {
  const scopeAllocates = income.scopeType === 'TENANT_SHARED' || income.scopeType === 'UNIT_GROUP';
  const originalDescription = (income.description ?? '').trim();
  const [categoryId, setCategoryId] = useState(income.categoryId);
  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState(income.currencyCode);
  const [receivedDate, setReceivedDate] = useState(toDateInputValue(income.receivedDate));
  const [description, setDescription] = useState(income.description ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const amountChanged = amount.trim() !== '';
    const amountMinor = amountChanged ? decimalToAmountMinor(amount) : income.amountMinor;
    if (amountChanged && !amountMinor) return setFormError('Ingresá un monto positivo con hasta dos decimales.');
    // Los ingresos con asignaciones por edificio no pueden cambiar monto/moneda.
    const descriptionChanged = description.trim() !== originalDescription;
    const dateChanged = !sameDateInput(receivedDate, income.receivedDate);
    const unchanged = !amountChanged && !dateChanged && !descriptionChanged && categoryId === income.categoryId && (scopeAllocates || currencyCode === income.currencyCode);
    if (unchanged) {
      onClose();
      return;
    }
    const data: UpdateIncomeData = { categoryId };
    if (descriptionChanged) data.description = description.trim();
    if (!scopeAllocates) {
      data.currencyCode = currencyCode;
      if (amountChanged && amountMinor != null) data.amountMinor = amountMinor;
    }
    if (dateChanged) data.receivedDate = toDateInputValue(receivedDate);
    setFormError(null);
    try {
      await updateIncome.mutateAsync({ incomeId: income.id, data });
      onClose();
    } catch {
      // Mutation error is rendered below.
    }
  };

  return <FinanceDialog title="Editar ingreso" labelledBy="income-edit-title" onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Rubro<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Seleccioná un rubro</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="text-sm font-medium">Moneda<select value={currencyCode} disabled={scopeAllocates} onChange={(event) => setCurrencyCode(event.target.value)} className="mt-1 w-full rounded border p-2">{CANONICAL_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
        <label className={`text-sm font-medium ${scopeAllocates ? 'opacity-60' : ''}`}>Monto<input inputMode="decimal" disabled={scopeAllocates} placeholder={scopeAllocates ? 'No editable con asignaciones' : 'Dejarlo vacío conserva el actual'} value={scopeAllocates ? minorToDecimalString(income.amountMinor) : amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded border p-2 disabled:cursor-not-allowed" /></label>
        <label className="text-sm font-medium">Fecha recibida<input required type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      </div>
      <label className="block text-sm font-medium">Descripción<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1 w-full rounded border p-2" /></label>
      {scopeAllocates ? <p className="text-xs text-muted-foreground">El monto y la moneda no pueden cambiarse porque este ingreso tiene asignaciones por edificio.</p> : <p className="text-xs text-muted-foreground">El alcance y las unidades asignadas no se modifican aquí; solo se pueden editar los campos que el contrato de actualización permite.</p>}
      {(formError || updateIncome.error) && <p role="alert" className="text-sm text-red-700">{formError ?? errorMessage(updateIncome.error, 'No pudimos guardar los cambios.')}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}><X className="mr-1 h-4 w-4" />Cancelar</Button><Button type="submit" disabled={updateIncome.isPending}>{updateIncome.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}Guardar</Button></div>
    </form>
  </FinanceDialog>;
}
