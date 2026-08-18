'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { formatCurrency } from '@/shared/lib/format/money';
import { useBuildings } from '@/features/buildings/hooks';
import { CANONICAL_CURRENCIES } from '../contracts';
import { useArchiveFund, useCreateFund, useCreateFundTransaction, useFund, useFunds, useFundTransactions, useReverseFundTransaction, useUpdateFund } from '../hooks/useFunds';
import { useFinanceSettings } from '../hooks/useFinanceSettings';
import { decimalToAmountMinor } from '../utils/money-input';
import { isFundTransactionReversible } from '../utils/fund-transaction';
import { resolveDefaultCurrency } from '../utils/currency-default';
import { todayLocalDate } from '../utils/date-input';
import type { Fund, FundTransaction, FundTransactionDirection } from '../contracts';
import { FinanceDialog } from './FinanceDialog';

interface FundsTabProps { readonly tenantId: string; }

function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }

export function FundsTab({ tenantId }: FundsTabProps) {
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedFundId, setSelectedFundId] = useState<string | null>(null);
  const { data: funds = [], isPending, error } = useFunds(tenantId, { status });
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-lg font-semibold">Fondos</h3><p className="text-sm text-muted-foreground">Los saldos se muestran separados por moneda, sin conversiones implícitas.</p></div><Button type="button" className="gap-2" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" />Crear fondo</Button></div>
    <label className="block max-w-xs text-sm font-medium">Estado<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="mt-1 w-full rounded border p-2"><option value="ACTIVE">Activos</option><option value="ARCHIVED">Archivados</option></select></label>
    {isPending ? <Card className="p-6 text-sm text-muted-foreground">Cargando fondos...</Card> : error ? <Card className="p-6 text-sm text-red-700">{message(error, 'No pudimos cargar los fondos.')}</Card> : funds.length === 0 ? <Card className="p-6 text-center text-sm text-muted-foreground">No hay fondos {status === 'ACTIVE' ? 'activos' : 'archivados'}.</Card> : <div className="grid gap-3 lg:grid-cols-2">{funds.map((fund) => <Card key={fund.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{fund.name}</p><p className="text-sm text-muted-foreground">{fund.type} · {fund.scopeType === 'TENANT' ? 'Conjunto' : 'Edificio'}</p>{fund.description && <p className="mt-1 text-sm text-muted-foreground">{fund.description}</p>}<div className="mt-3 space-y-1">{fund.balancesByCurrency.length ? fund.balancesByCurrency.map((balance) => <p key={balance.currency} className="text-sm font-medium">{balance.currency}: {formatCurrency(balance.amountMinor, balance.currency)}</p>) : <p className="text-sm text-muted-foreground">Sin movimientos.</p>}</div></div><Button type="button" size="sm" variant="secondary" onClick={() => setSelectedFundId(fund.id)}>Ver detalle</Button></div></Card>)}</div>}
    {showCreate && <FundFormDialog tenantId={tenantId} onClose={() => setShowCreate(false)} />}
    {selectedFundId && <FundDetailDialog tenantId={tenantId} fundId={selectedFundId} onClose={() => setSelectedFundId(null)} />}
  </div>;
}

function FundFormDialog({ tenantId, fund, onClose }: { readonly tenantId: string; readonly fund?: Fund; readonly onClose: () => void }) {
  const [scopeType, setScopeType] = useState(fund?.scopeType ?? 'TENANT');
  const [buildingId, setBuildingId] = useState(fund?.buildingId ?? '');
  const [type, setType] = useState(fund?.type ?? 'RESERVE');
  const [name, setName] = useState(fund?.name ?? '');
  const [description, setDescription] = useState(fund?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateFund(tenantId);
  const update = useUpdateFund(tenantId, fund?.id ?? '');
  const { buildings } = useBuildings(tenantId);
  const submit = async () => {
    if (!name.trim()) return setError('El nombre del fondo es obligatorio.');
    if (!fund && scopeType === 'BUILDING' && !buildingId) return setError('Seleccioná el edificio del fondo.');
    setError(null);
    try {
      if (fund) await update.mutateAsync({ name: name.trim(), description: description.trim() });
      else await create.mutateAsync({ scopeType, buildingId: scopeType === 'BUILDING' ? buildingId : undefined, type, name: name.trim(), description: description.trim() || undefined });
      onClose();
    } catch { /* Mutation error is rendered below. */ }
  };
  const mutation = fund ? update : create;
  return <FinanceDialog title={fund ? 'Editar fondo' : 'Crear fondo'} labelledBy="fund-form-title" onClose={onClose}><div className="space-y-3">{!fund && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Alcance<select value={scopeType} onChange={(event) => setScopeType(event.target.value as typeof scopeType)} className="mt-1 w-full rounded border p-2"><option value="TENANT">Conjunto</option><option value="BUILDING">Edificio</option></select></label><label className="text-sm font-medium">Tipo<select value={type} onChange={(event) => setType(event.target.value as typeof type)} className="mt-1 w-full rounded border p-2"><option value="RESERVE">Reserva</option><option value="SPECIAL">Especial</option><option value="OTHER">Otro</option></select></label>{scopeType === 'BUILDING' && <label className="text-sm font-medium sm:col-span-2">Edificio<select value={buildingId} onChange={(event) => setBuildingId(event.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Seleccioná un edificio</option>{buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label>}</div>}<label className="block text-sm font-medium">Nombre<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded border p-2" /></label><label className="block text-sm font-medium">Descripción<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-1 w-full rounded border p-2" /></label>{(error || mutation.error) && <p role="alert" className="text-sm text-red-700">{error ?? message(mutation.error, 'No pudimos guardar el fondo.')}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="button" disabled={mutation.isPending} onClick={() => void submit()}>{mutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Guardar</Button></div></div></FinanceDialog>;
}

function FundDetailDialog({ tenantId, fundId, onClose }: { readonly tenantId: string; readonly fundId: string; readonly onClose: () => void }) {
  const { data: fund, isPending, error } = useFund(tenantId, fundId);
  const { data: transactions = [], isPending: transactionsPending, error: transactionsError } = useFundTransactions(tenantId, fundId, { limit: 100 });
  const [editing, setEditing] = useState(false);
  const [manualTransaction, setManualTransaction] = useState(false);
  const [reversing, setReversing] = useState<string | null>(null);
  const archive = useArchiveFund(tenantId, fundId);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  if (isPending) return <FinanceDialog title="Detalle de fondo" labelledBy="fund-detail-title" onClose={onClose}><p className="text-sm text-muted-foreground">Cargando fondo...</p></FinanceDialog>;
  if (error || !fund) return <FinanceDialog title="Detalle de fondo" labelledBy="fund-detail-title" onClose={onClose}><p role="alert" className="text-sm text-red-700">{message(error, 'No pudimos cargar el fondo.')}</p></FinanceDialog>;
  return <FinanceDialog title={fund.name} labelledBy="fund-detail-title" onClose={onClose}><div className="space-y-4"><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>Editar</Button>{fund.status === 'ACTIVE' && <><Button type="button" size="sm" onClick={() => setManualTransaction(true)}>Movimiento manual</Button><Button type="button" variant="secondary" size="sm" onClick={() => setArchiveConfirm(true)}>Archivar</Button></>}</div><div className="rounded border p-3"><p className="text-sm font-medium">Saldos por moneda</p>{fund.balancesByCurrency.map((balance) => <p key={balance.currency} className="mt-1 text-sm">{balance.currency}: {formatCurrency(balance.amountMinor, balance.currency)}</p>)}</div>      <div><h3 className="mb-2 text-sm font-medium">Libro de movimientos</h3>{transactionsPending ? <p className="text-sm text-muted-foreground">Cargando movimientos...</p> : transactionsError ? <p role="alert" className="text-sm text-red-700">{message(transactionsError, 'No pudimos cargar los movimientos.')}</p> : transactions.length === 0 ? <p className="text-sm text-muted-foreground">Sin movimientos.</p> : <div className="space-y-2">{transactions.map((transaction) => <TransactionRow key={transaction.id} fundStatus={fund.status} transaction={transaction} transactions={transactions} onReverse={(transactionId) => setReversing(transactionId)} />)}</div>}</div></div>
    {editing && <FundFormDialog tenantId={tenantId} fund={fund} onClose={() => setEditing(false)} />}
    {manualTransaction && <FundTransactionDialog tenantId={tenantId} fundId={fund.id} onClose={() => setManualTransaction(false)} />}
    {archiveConfirm && <FinanceDialog title="Archivar fondo" labelledBy="archive-fund-title" onClose={() => setArchiveConfirm(false)}><p className="text-sm text-muted-foreground">El fondo dejará de estar disponible para nuevas aplicaciones. Esta acción no borra el libro.</p>{archive.error && <p role="alert" className="mt-3 text-sm text-red-700">{message(archive.error, 'No pudimos archivar el fondo.')}</p>}<div className="mt-5 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setArchiveConfirm(false)}>Cancelar</Button><Button type="button" disabled={archive.isPending} onClick={() => void archive.mutateAsync().then(() => setArchiveConfirm(false)).catch(() => undefined)}>Confirmar archivo</Button></div></FinanceDialog>}
    {reversing && <ReverseTransactionDialog tenantId={tenantId} fundId={fund.id} transactionId={reversing} onClose={() => setReversing(null)} />}
  </FinanceDialog>;
}

function FundTransactionDialog({ tenantId, fundId, onClose }: { readonly tenantId: string; readonly fundId: string; readonly onClose: () => void }) {
  const { data: financeSettings } = useFinanceSettings(tenantId);
  const [direction, setDirection] = useState<FundTransactionDirection>('CREDIT'); const [amount, setAmount] = useState('');
  const [explicitCurrency, setExplicitCurrency] = useState<string | null>(null);
  const currencyCode = explicitCurrency ?? resolveDefaultCurrency(financeSettings?.functionalCurrency, CANONICAL_CURRENCIES);
  const [occurredAt, setOccurredAt] = useState(() => todayLocalDate()); const [description, setDescription] = useState(''); const [formError, setFormError] = useState<string | null>(null); const create = useCreateFundTransaction(tenantId, fundId);
  const submit = async () => { const amountMinor = decimalToAmountMinor(amount); if (!amountMinor) return setFormError('Ingresá un monto positivo con hasta dos decimales.'); setFormError(null); try { await create.mutateAsync({ direction, amountMinor, currencyCode, occurredAt, description: description.trim() || undefined }); onClose(); } catch { /* Mutation error is rendered below. */ } };
  return <FinanceDialog title="Movimiento manual" labelledBy="fund-transaction-title" onClose={onClose}><div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Dirección<select value={direction} onChange={(event) => setDirection(event.target.value as FundTransactionDirection)} className="mt-1 w-full rounded border p-2"><option value="CREDIT">Crédito</option><option value="DEBIT">Débito</option></select></label><label className="text-sm font-medium">Moneda<select value={currencyCode} onChange={(event) => setExplicitCurrency(event.target.value)} className="mt-1 w-full rounded border p-2">{CANONICAL_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label><label className="text-sm font-medium">Monto<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded border p-2" /></label><label className="text-sm font-medium">Fecha<input type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} className="mt-1 w-full rounded border p-2" /></label></div><label className="block text-sm font-medium">Descripción<input value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>{(formError || create.error) && <p role="alert" className="text-sm text-red-700">{formError ?? message(create.error, 'No pudimos crear el movimiento.')}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="button" disabled={create.isPending} onClick={() => void submit()}>Registrar movimiento</Button></div></div></FinanceDialog>;
}

function ReverseTransactionDialog({ tenantId, fundId, transactionId, onClose }: { readonly tenantId: string; readonly fundId: string; readonly transactionId: string; readonly onClose: () => void }) { const [reason, setReason] = useState(''); const reverse = useReverseFundTransaction(tenantId, fundId); return <FinanceDialog title="Revertir movimiento" labelledBy="reverse-fund-transaction-title" onClose={onClose}><p className="text-sm text-muted-foreground">La reversión crea un contramovimiento; no elimina el registro original.</p><label className="mt-3 block text-sm font-medium">Motivo (opcional)<input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>{reverse.error && <p role="alert" className="mt-3 text-sm text-red-700">{message(reverse.error, 'No pudimos revertir el movimiento.')}</p>}<div className="mt-5 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="button" disabled={reverse.isPending} onClick={() => void reverse.mutateAsync({ transactionId, data: { reason: reason.trim() || undefined } }).then(onClose).catch(() => undefined)}>Confirmar reversión</Button></div></FinanceDialog>; }

function TransactionRow({ fundStatus, transaction, transactions, onReverse }: {
  readonly fundStatus: Fund['status'];
  readonly transaction: FundTransaction;
  readonly transactions: readonly FundTransaction[];
  readonly onReverse: (transactionId: string) => void;
}) {
  const reversible = fundStatus === 'ACTIVE' && isFundTransactionReversible(transaction, transactions);
  const ownedByApplication = transaction.incomeApplicationId !== null;
  return <div className="flex flex-col gap-2 rounded border p-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="text-sm">
      <span className="font-medium">{transaction.direction}</span> · {formatCurrency(transaction.amountMinor, transaction.currencyCode)}
      <p className="text-muted-foreground">{transaction.occurredAt.slice(0, 10)} · {transaction.description || 'Sin descripción'}{transaction.reversalOfTransactionId ? ' · Reversión' : ''}</p>
      {ownedByApplication && <p className="text-xs text-muted-foreground">Generado por una aplicación de ingreso; se revierte solo mediante la anulación del ingreso.</p>}
    </div>
    {reversible && <Button type="button" size="sm" variant="secondary" onClick={() => onReverse(transaction.id)}>Revertir</Button>}
  </div>;
}
