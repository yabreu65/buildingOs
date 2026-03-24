'use client';

import { useEffect, useState } from 'react';
import { auditLogsApi, AuditLog } from '@/features/super-admin/services/audit-logs.api';

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skip, setSkip] = useState(0);
  const take = 50;

  useEffect(() => {
    loadLogs();
  }, [skip]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const response = await auditLogsApi.listLogs(skip, take);
      setLogs(response.data);
      setError(null);
    } catch (err) {
      setError('Failed to load audit logs');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getActionColor = (action: string) => {
    if (action.includes('CREATE')) return 'bg-green-100 text-green-800';
    if (action.includes('DELETE')) return 'bg-red-100 text-red-800';
    if (action.includes('UPDATE')) return 'bg-blue-100 text-blue-800';
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
          Audit Logs
        </h1>
        <p className="text-muted-foreground mt-2">Historial de todas las operaciones en BuildingOS</p>
      </div>

      {/* Logs Table */}
      <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
        <h2 className="text-xl font-bold text-foreground mb-6">📋 Event History</h2>

        {loading && <div className="text-muted-foreground text-center py-8">Cargando logs...</div>}

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-4 rounded-lg mb-4">
            {error}
          </div>
        )}

        {!loading && logs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Acción</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Entity</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Tenant</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Fecha</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Detalles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/50 transition-colors">
                    <td className="py-3 px-4">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{log.entity}</td>
                    <td className="py-3 px-4 text-muted-foreground text-xs font-mono">
                      {log.tenantId ? log.tenantId.slice(0, 8) + '...' : '—'}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground text-xs">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">
                      {log.metadata && Object.keys(log.metadata).length > 0 ? (
                        <code className="bg-muted px-2 py-1 rounded">
                          {JSON.stringify(log.metadata).slice(0, 50)}...
                        </code>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && logs.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            📭 No hay audit logs disponibles
          </div>
        )}

        {/* Pagination */}
        {!loading && logs.length > 0 && (
          <div className="flex gap-3 justify-between items-center mt-6 pt-6 border-t border-border">
            <button
              onClick={() => setSkip(Math.max(0, skip - take))}
              disabled={skip === 0}
              className="px-4 py-2 rounded-lg hover:bg-muted disabled:opacity-50 text-foreground transition-colors"
            >
              ← Anterior
            </button>
            <span className="text-sm text-muted-foreground">
              Mostrando {skip + 1} - {skip + logs.length}
            </span>
            <button
              onClick={() => setSkip(skip + take)}
              disabled={logs.length < take}
              className="px-4 py-2 rounded-lg hover:bg-muted disabled:opacity-50 text-foreground transition-colors"
            >
              Siguiente →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
