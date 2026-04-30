'use client';

import { useEffect, useState } from 'react';
import { opsService, HitlMetricsResponse } from '@/shared/services/opsService';

export default function OpsMetricsPage() {
  const [tenantId, setTenantId] = useState('');
  const [metrics, setMetrics] = useState<HitlMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await opsService.getHitlMetrics(tenantId.trim() || undefined);
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pude cargar métricas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Ops Metrics</h1>
        <p className="text-muted-foreground">KPIs de HITL y AI layer</p>
      </div>

      <div className="rounded-lg border p-4 flex items-end gap-3">
        <div>
          <label className="block text-sm mb-1">Tenant ID</label>
          <input
            className="border rounded px-3 py-2 w-72"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="global (empty)"
          />
        </div>
        <button className="px-4 py-2 rounded bg-black text-white" onClick={() => void load()}>
          Consultar
        </button>
      </div>

      {loading && <div>Cargando...</div>}
      {error && <div className="text-red-600">{error}</div>}

      {!loading && !error && metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="rounded-lg border p-4">
            <h3 className="text-sm text-muted-foreground">HITL Open</h3>
            <p className="text-3xl font-bold">{metrics.handoffsOpenCount}</p>
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm text-muted-foreground">Assign p95</h3>
            <p className="text-3xl font-bold">
              {metrics.timeToAssignP95Minutes !== null ? `${metrics.timeToAssignP95Minutes.toFixed(1)}m` : 'N/A'}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm text-muted-foreground">Resolve p95</h3>
            <p className="text-3xl font-bold">
              {metrics.timeToResolveP95Hours !== null ? `${metrics.timeToResolveP95Hours.toFixed(1)}h` : 'N/A'}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm text-muted-foreground">SLA Breaches</h3>
            <p className="text-3xl font-bold text-red-600">
              {metrics.breachedSlaCount.total}
            </p>
            <p className="text-xs text-muted-foreground">
              assign: {metrics.breachedSlaCount.assign} | resolve: {metrics.breachedSlaCount.resolve}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm text-muted-foreground">AI Gateway Error (15m)</h3>
            <p className="text-3xl font-bold">
              {metrics.aiHealth15m.gatewayErrorRate !== null
                ? `${(metrics.aiHealth15m.gatewayErrorRate * 100).toFixed(1)}%`
                : 'N/A'}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm text-muted-foreground">AI P0 No-Data (15m)</h3>
            <p className="text-3xl font-bold">
              {metrics.aiHealth15m.p0NoDataRate !== null
                ? `${(metrics.aiHealth15m.p0NoDataRate * 100).toFixed(1)}%`
                : 'N/A'}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm text-muted-foreground">Cache Hit Rate (15m)</h3>
            <p className="text-3xl font-bold">
              {metrics.aiHealth15m.cacheHitRate !== null
                ? `${(metrics.aiHealth15m.cacheHitRate * 100).toFixed(1)}%`
                : 'N/A'}
            </p>
          </div>
        </div>
      )}

      {!loading && !error && metrics && metrics.topFallbackPaths24h.length > 0 && (
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold mb-3">Top Fallback Paths (24h)</h3>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">Fallback Path</th>
                <th className="px-3 py-2">Count</th>
              </tr>
            </thead>
            <tbody>
              {metrics.topFallbackPaths24h.map((row, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-3 py-2 font-mono">{row.fallbackPath}</td>
                  <td className="px-3 py-2">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}