'use client';

import { CANONICAL_CURRENCIES, type CanonicalCurrency } from '@buildingos/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useCan } from '@/features/rbac/rbac.hooks';
import { createExchangeRate, getFinanceSettings, listExchangeRates, updateExchangeRate, updateFinanceSettings } from '../services/multicurrency.api';

interface Props { readonly tenantId: string }

const DECIMAL_28_12_POSITIVE_PATTERN = /^(?!0+(?:\.0+)?$)\d{1,16}(?:\.\d{1,12})?$/;

function formatCalendarDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function MulticurrencySettings({ tenantId }: Props) {
  const canWrite = useCan('finance.settings.write', tenantId);
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['finance-settings', tenantId], queryFn: () => getFinanceSettings(tenantId) });
  const rates = useQuery({ queryKey: ['exchange-rates', tenantId], queryFn: () => listExchangeRates(tenantId) });
  const [functionalCurrency, setFunctionalCurrency] = useState<CanonicalCurrency | null>(null);
  const [baseCurrency, setBaseCurrency] = useState<CanonicalCurrency>('USD');
  const [quoteCurrency, setQuoteCurrency] = useState<CanonicalCurrency>('VES');
  const [rate, setRate] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [source, setSource] = useState('');
  const [sourceTouched, setSourceTouched] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const selectedFunctionalCurrency = functionalCurrency ?? settings.data?.functionalCurrency ?? 'ARS';
  const saveSettings = useMutation({ mutationFn: () => updateFinanceSettings(tenantId, selectedFunctionalCurrency), onSuccess: () => client.invalidateQueries({ queryKey: ['finance-settings', tenantId] }) });
  const saveRate = useMutation({ mutationFn: () => {
    const input = { rate, effectiveAt };
    return editingId
      ? updateExchangeRate(tenantId, editingId, { ...input, ...(sourceTouched ? { source: source.trim() } : {}) })
      : createExchangeRate(tenantId, { baseCurrency, quoteCurrency, ...input, ...(source.trim() ? { source: source.trim() } : {}) });
  }, onSuccess: () => { setRate(''); setSource(''); setSourceTouched(false); setEffectiveAt(''); setEditingId(null); void client.invalidateQueries({ queryKey: ['exchange-rates', tenantId] }); } });

  const submitRate = (event: FormEvent) => {
    event.preventDefault();
    if (baseCurrency === quoteCurrency) return setValidationError('Origen y destino deben ser diferentes.');
    if (!rate) return setValidationError('La tasa es obligatoria.');
    if (!DECIMAL_28_12_POSITIVE_PATTERN.test(rate)) return setValidationError('La tasa debe ser mayor que cero.');
    if (!effectiveAt) return setValidationError('La fecha efectiva es obligatoria.');
    setValidationError(null);
    saveRate.mutate();
  };

  if (settings.isLoading || rates.isLoading) return <Card className="p-6">Cargando configuración monetaria...</Card>;
  const error = settings.error || rates.error;
  if (error) return <Card className="p-6 text-red-700">No pudimos cargar la configuración monetaria: {error instanceof Error ? error.message : 'Error desconocido'}</Card>;

  return <div className="space-y-4">
    <Card className="p-6 space-y-3">
      <h2 className="font-semibold">Moneda funcional</h2>
      <p className="text-sm text-muted-foreground">Moneda de referencia contable del tenant. No convierte movimientos existentes.</p>
      {canWrite ? <div className="flex gap-2">
          <select aria-label="Moneda funcional" value={selectedFunctionalCurrency} onChange={(event) => setFunctionalCurrency(event.target.value as CanonicalCurrency)} className="border rounded px-3 py-2">
            {CANONICAL_CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}
          </select>
          <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>Guardar</Button>
        </div> : <p>{selectedFunctionalCurrency}</p>}
      {saveSettings.isSuccess && <p className="text-sm text-green-700">Moneda funcional actualizada.</p>}
      {saveSettings.error && <p className="text-sm text-red-700">{saveSettings.error.message}</p>}
    </Card>
    <Card className="p-6 space-y-4">
      <h2 className="font-semibold">Tasas de cambio</h2>
      <p className="text-sm text-muted-foreground">Semántica: 1 moneda de origen = tasa monedas de destino.</p>
      {canWrite && <form onSubmit={submitRate} className="grid gap-3 md:grid-cols-5">
        <select aria-label="Origen" value={baseCurrency} disabled={editingId !== null} onChange={(event) => setBaseCurrency(event.target.value as CanonicalCurrency)} className="border rounded px-3 py-2">{CANONICAL_CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select>
        <select aria-label="Destino" value={quoteCurrency} disabled={editingId !== null} onChange={(event) => setQuoteCurrency(event.target.value as CanonicalCurrency)} className="border rounded px-3 py-2">{CANONICAL_CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select>
        <input aria-label="Tasa" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="Tasa" inputMode="decimal" className="border rounded px-3 py-2" />
        <input aria-label="Fecha efectiva" type="date" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} className="border rounded px-3 py-2" />
        <input aria-label="Fuente" value={source} onChange={(event) => { setSource(event.target.value); setSourceTouched(true); }} placeholder="Fuente (opcional)" className="border rounded px-3 py-2" />
        <Button type="submit" disabled={saveRate.isPending}>{editingId ? 'Guardar cambios' : 'Agregar tasa'}</Button>
      </form>}
      {validationError && <p className="text-sm text-red-700">{validationError}</p>}
      {saveRate.isSuccess && <p className="text-sm text-green-700">Tasa guardada.</p>}
      {saveRate.error && <p className="text-sm text-red-700">{saveRate.error.message}</p>}
      {!rates.data?.length ? <p className="text-sm text-muted-foreground">No hay tasas registradas.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>Origen</th><th>Destino</th><th>Tasa</th><th>Fecha efectiva</th><th>Fuente</th>{canWrite && <th>Acciones</th>}</tr></thead><tbody>{rates.data.map((item) => <tr key={item.id}><td>{item.baseCurrency}</td><td>{item.quoteCurrency}</td><td>{item.rate}</td><td>{formatCalendarDate(item.effectiveAt)}</td><td>{item.source || 'Sin fuente'}</td>{canWrite && <td><button type="button" onClick={() => { setEditingId(item.id); setBaseCurrency(item.baseCurrency); setQuoteCurrency(item.quoteCurrency); setRate(item.rate); setEffectiveAt(item.effectiveAt.slice(0, 10)); setSource(item.source || ''); setSourceTouched(false); }}>Editar</button></td>}</tr>)}</tbody></table></div>}
    </Card>
  </div>;
}
