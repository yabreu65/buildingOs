'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useExpenseLedgerCategories } from '../hooks/useExpenseLedger';
import { useFunds } from '../hooks/useFunds';
import { useCreateIncomePolicy, useCreateIncomePolicyVersion, useDeactivateIncomePolicy, useIncomePolicies } from '../hooks/useIncomePolicies';
import { percentageToBasisPoints } from '../utils/money-input';
import type { CreateIncomePolicyRuleData, IncomeApplicationDestination, IncomePolicy } from '../contracts';
import { FinanceDialog } from './FinanceDialog';

interface IncomePoliciesTabProps { readonly tenantId: string; }

interface RuleDraft { readonly id: string; destinationType: IncomeApplicationDestination; fundId: string; percentage: string; }

function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }

export function IncomePoliciesTab({ tenantId }: IncomePoliciesTabProps) {
  const [creating, setCreating] = useState(false);
  const [versioning, setVersioning] = useState<IncomePolicy | null>(null);
  const [deactivating, setDeactivating] = useState<IncomePolicy | null>(null);
  const { data: policies = [], isPending, error } = useIncomePolicies(tenantId);
  const { data: categories = [] } = useExpenseLedgerCategories(tenantId, 'INCOME');
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const deactivate = useDeactivateIncomePolicy(tenantId, deactivating?.categoryId ?? '');
  return <div className="space-y-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-lg font-semibold">Políticas de ingreso</h3><p className="text-sm text-muted-foreground">Cada versión distribuye exactamente 10.000 puntos básicos y queda como procedencia del plan aplicado.</p></div><Button type="button" className="gap-2" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Crear política</Button></div>{isPending ? <Card className="p-6 text-sm text-muted-foreground">Cargando políticas...</Card> : error ? <Card className="p-6 text-sm text-red-700">{message(error, 'No pudimos cargar las políticas.')}</Card> : policies.length === 0 ? <Card className="p-6 text-center text-sm text-muted-foreground">No hay políticas de ingreso configuradas.</Card> : <div className="space-y-3">{policies.map((policy) => <Card key={policy.id} className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-medium">{categoryNames.get(policy.categoryId) ?? policy.categoryId}</p>{policy.currentVersion ? <><p className="text-sm text-muted-foreground">Versión {policy.currentVersion.version} · {policy.currentVersion.status}</p><PolicyRules tenantId={tenantId} rules={policy.currentVersion.rules} /></> : <p className="text-sm text-muted-foreground">Sin versión activa.</p>}</div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => setVersioning(policy)}>Nueva versión</Button>{policy.currentVersion?.status === 'ACTIVE' && <Button type="button" size="sm" variant="secondary" onClick={() => setDeactivating(policy)}>Desactivar</Button>}</div></div></Card>)}</div>}{creating && <PolicyFormDialog tenantId={tenantId} usedCategoryIds={new Set(policies.map((policy) => policy.categoryId))} onClose={() => setCreating(false)} />}{versioning && <PolicyFormDialog tenantId={tenantId} policy={versioning} usedCategoryIds={new Set()} onClose={() => setVersioning(null)} />}{deactivating && <FinanceDialog title="Desactivar política" labelledBy="deactivate-policy-title" onClose={() => setDeactivating(null)}><p className="text-sm text-muted-foreground">Las nuevas aplicaciones no usarán esta política. Los planes ya aplicados no cambian.</p>{deactivate.error && <p role="alert" className="mt-3 text-sm text-red-700">{message(deactivate.error, 'No pudimos desactivar la política.')}</p>}<div className="mt-5 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDeactivating(null)}>Cancelar</Button><Button type="button" disabled={deactivate.isPending} onClick={() => void deactivate.mutateAsync().then(() => setDeactivating(null)).catch(() => undefined)}>{deactivate.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Confirmar desactivación</Button></div></FinanceDialog>}</div>;
}

function PolicyRules({ tenantId, rules }: { readonly tenantId: string; readonly rules: readonly { id: string; destinationType: string; fundId: string | null; percentageBasisPoints: number }[] }) { const { data: funds = [] } = useFunds(tenantId, {}); return <div className="mt-2 space-y-1">{rules.map((rule) => <p key={rule.id} className="text-sm text-muted-foreground">{rule.destinationType}{rule.fundId ? ` · ${funds.find((fund) => fund.id === rule.fundId)?.name ?? rule.fundId}` : ''}: {rule.percentageBasisPoints} bps</p>)}</div>; }

function PolicyFormDialog({ tenantId, policy, usedCategoryIds, onClose }: { readonly tenantId: string; readonly policy?: IncomePolicy; readonly usedCategoryIds: ReadonlySet<string>; readonly onClose: () => void }) {
  const { data: categories = [] } = useExpenseLedgerCategories(tenantId, 'INCOME');
  const { data: funds = [] } = useFunds(tenantId, { status: 'ACTIVE' });
  const [categoryId, setCategoryId] = useState(policy?.categoryId ?? '');
  const [rules, setRules] = useState<RuleDraft[]>([{ id: 'first', destinationType: 'OFFSET_EXPENSES', fundId: '', percentage: '100' }]);
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateIncomePolicy(tenantId);
  const version = useCreateIncomePolicyVersion(tenantId, policy?.categoryId ?? '');
  const mutation = policy ? version : create;
  const updateRule = (id: string, field: keyof Omit<RuleDraft, 'id'>, value: string) => setRules((current) => current.map((rule) => rule.id === id ? { ...rule, [field]: value } : rule));
  const submit = async () => {
    if (!policy && !categoryId) return setFormError('Seleccioná un rubro de ingreso.');
    const parsed: CreateIncomePolicyRuleData[] = [];
    for (const rule of rules) { const percentageBasisPoints = percentageToBasisPoints(rule.percentage); if (!percentageBasisPoints) return setFormError('Cada porcentaje debe estar entre 0,01% y 100%, con hasta dos decimales.'); if (rule.destinationType === 'FUND' && !rule.fundId) return setFormError('Las reglas de fondo requieren seleccionar un fondo activo.'); parsed.push({ destinationType: rule.destinationType, fundId: rule.destinationType === 'FUND' ? rule.fundId : undefined, percentageBasisPoints }); }
    if (parsed.reduce((total, rule) => total + rule.percentageBasisPoints, 0) !== 10000) return setFormError('La suma de reglas debe ser exactamente 10.000 bps (100%).');
    setFormError(null); try { if (policy) await version.mutateAsync({ rules: parsed }); else await create.mutateAsync({ categoryId, rules: parsed }); onClose(); } catch { /* Mutation error is rendered below. */ }
  };
  return <FinanceDialog title={policy ? 'Crear nueva versión' : 'Crear política de ingreso'} labelledBy="income-policy-form-title" onClose={onClose}><div className="space-y-4">{!policy && <label className="block text-sm font-medium">Rubro de ingreso<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Seleccioná un rubro</option>{categories.filter((category) => !usedCategoryIds.has(category.id)).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}<div className="space-y-2 rounded border p-3"><p className="text-sm font-medium">Reglas</p>{rules.map((rule) => <div key={rule.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_130px_auto]"><select aria-label="Destino de política" value={rule.destinationType} onChange={(event) => updateRule(rule.id, 'destinationType', event.target.value)} className="rounded border p-2"><option value="OFFSET_EXPENSES">Compensar gastos</option><option value="FUND">Fondo</option><option value="CARRY_FORWARD">Arrastre</option></select>{rule.destinationType === 'FUND' ? <select aria-label="Fondo de política" value={rule.fundId} onChange={(event) => updateRule(rule.id, 'fundId', event.target.value)} className="rounded border p-2"><option value="">Seleccioná un fondo</option>{funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select> : <span className="hidden sm:block" />}<input aria-label="Porcentaje" inputMode="decimal" value={rule.percentage} onChange={(event) => updateRule(rule.id, 'percentage', event.target.value)} placeholder="Porcentaje" className="rounded border p-2" /><Button type="button" size="sm" variant="secondary" disabled={rules.length === 1} onClick={() => setRules((current) => current.filter((item) => item.id !== rule.id))}>Quitar</Button></div>)}<Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setRules((current) => [...current, { id: String(Date.now()), destinationType: 'OFFSET_EXPENSES', fundId: '', percentage: '' }])}>Agregar regla</Button></div>{(formError || mutation.error) && <p role="alert" className="text-sm text-red-700">{formError ?? message(mutation.error, 'No pudimos guardar la política.')}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="button" disabled={mutation.isPending} onClick={() => void submit()}>{mutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Guardar versión</Button></div></div></FinanceDialog>;
}
