'use client';

import { useEffect, useState } from 'react';
import { opsService, OpsAlert } from '@/shared/services/opsService';

const severityColor: Record<string, string> = {
  INFO: 'bg-blue-100 text-blue-900',
  WARNING: 'bg-yellow-100 text-yellow-900',
  CRITICAL: 'bg-red-100 text-red-900',
};

export default function OpsAlertsPage() {
  const [status, setStatus] = useState<'open' | 'ack' | 'resolved'>('open');
  const [tenantId, setTenantId] = useState('');
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await opsService.listAlerts({ status, tenantId: tenantId.trim() || undefined, limit: 50 });
      setAlerts(response.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pude cargar alertas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status]);

  const onAck = async (id: string) => {
    await opsService.ackAlert(id);
    await load();
  };

  const onResolve = async (id: string) => {
    await opsService.resolveAlert(id);
    await load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Ops Alerts</h1>
        <p className="text-muted-foreground">Alertas automáticas de HITL y AI layer</p>
      </div>

      <div className="rounded-lg border p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm mb-1">Status</label>
          <select className="border rounded px-3 py-2" value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="open">Open</option>
            <option value="ack">Ack</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">Tenant ID</label>
          <input className="border rounded px-3 py-2 w-72" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="all tenants" />
        </div>
        <button className="px-4 py-2 rounded bg-black text-white" onClick={() => void load()}>
          Filtrar
        </button>
      </div>

      {loading && <div>Cargando...</div>}
      {error && <div className="text-red-600">{error}</div>}

      {!loading && !error && (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Message</th>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Snapshot</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id} className="border-t align-top">
                  <td className="px-3 py-2 font-mono">{alert.code}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-1 rounded text-xs ${severityColor[alert.severity] || ''}`}>
                      {alert.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2">{alert.message}</td>
                  <td className="px-3 py-2 font-mono">{alert.tenantId ?? 'global'}</td>
                  <td className="px-3 py-2">{new Date(alert.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <pre className="text-xs whitespace-pre-wrap max-w-xl">{JSON.stringify(alert.metricsJson, null, 2)}</pre>
                  </td>
                  <td className="px-3 py-2">
                    {alert.status === 'OPEN' && (
                      <div className="flex gap-2">
                        <button className="px-2 py-1 border rounded" onClick={() => void onAck(alert.id)}>Ack</button>
                        <button className="px-2 py-1 border rounded" onClick={() => void onResolve(alert.id)}>Resolve</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
