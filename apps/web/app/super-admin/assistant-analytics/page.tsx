'use client';

import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
  LineChart,
  Line,
} from 'recharts';

interface OverviewMetrics {
  totalEvents: number;
  uniqueTenants: number;
  uniqueSessions: number;
  avgActionsPerMessage: number;
  mappedClicks: number;
  unmappedClicks: number;
}

interface ActionMetrics {
  actionKey: string;
  actionLabel: string;
  clicks: number;
}

interface PositionMetrics {
  position: number;
  clicks: number;
  totalActions: number;
}

interface TenantMetrics {
  tenantId: string;
  eventCount: number;
}

interface DailyMetrics {
  date: string;
  eventCount: number;
}

interface FeedbackMetrics {
  totalFeedbacks: number;
  usefulCount: number;
  notUsefulCount: number;
  usefulRate: number;
}

interface CommentItem {
  comment: string;
  rating: string;
  tenantId: string;
  currentModule: string | null;
  createdAt: string;
}

interface FeedbackDailyItem {
  date: string;
  usefulCount: number;
  notUsefulCount: number;
}

interface ModuleMetricsItem {
  currentModule: string;
  totalEvents: number;
  usefulCount: number;
  notUsefulCount: number;
  usefulRate: number;
}

const API_URL = process.env.NEXT_PUBLIC_ASSISTANT_API_URL || 'http://localhost:4001';

export default function AssistantAnalyticsPage() {
  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [actions, setActions] = useState<ActionMetrics[]>([]);
  const [positions, setPositions] = useState<PositionMetrics[]>([]);
  const [tenants, setTenants] = useState<TenantMetrics[]>([]);
  const [daily, setDaily] = useState<DailyMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const [tenantsList, setTenantsList] = useState<{ tenantId: string; eventCount: number }[]>([]);
  const [feedback, setFeedback] = useState<FeedbackMetrics | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [feedbackDaily, setFeedbackDaily] = useState<FeedbackDailyItem[]>([]);
  const [moduleMetrics, setModuleMetrics] = useState<ModuleMetricsItem[]>([]);
  
  const [tenantId, setTenantId] = useState('');
  const [currentModule, setCurrentModule] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const hasFilters = tenantId || fromDate || toDate || currentModule;
  const hasNoData = !loading && overview?.totalEvents === 0;

  const fetchTenantsList = async () => {
    try {
      const res = await fetch(`${API_URL}/api/analytics/metrics/tenants/list`);
      const data = await res.json();
      setTenantsList(data);
    } catch (err) {
      console.error('Failed to fetch tenants list:', err);
    }
  };

  const buildQueryParams = () => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    if (currentModule) params.set('currentModule', currentModule);
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    return params.toString();
  };

  const fetchMetrics = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    
    const queryParams = buildQueryParams();
    const baseUrl = `${API_URL}/api/analytics/metrics`;
    const suffix = queryParams ? `?${queryParams}` : '';

    try {
      const [overviewRes, actionsRes, positionsRes, tenantsRes, dailyRes, feedbackRes, commentsRes, feedbackDailyRes, moduleMetricsRes] = await Promise.all([
        fetch(`${baseUrl}/overview${suffix}`),
        fetch(`${baseUrl}/actions${suffix}`),
        fetch(`${baseUrl}/positions${suffix}`),
        fetch(`${baseUrl}/tenants${suffix}`),
        fetch(`${baseUrl}/daily${suffix}`),
        fetch(`${baseUrl}/feedback${suffix}`),
        fetch(`${baseUrl}/feedback/comments${suffix ? '&' + queryParams.replace('?', '') : '?limit=10'}`),
        fetch(`${baseUrl}/feedback/daily${suffix}`),
        fetch(`${baseUrl}/modules${suffix}`),
      ]);

      setOverview(await overviewRes.json());
      setActions(await actionsRes.json());
      setPositions(await positionsRes.json());
      setTenants(await tenantsRes.json());
      setDaily(await dailyRes.json());
      setFeedback(await feedbackRes.json());
      setComments(await commentsRes.json());
      setFeedbackDaily(await feedbackDailyRes.json());
      setModuleMetrics(await moduleMetricsRes.json());
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchMetrics(false);
    fetchTenantsList();
  }, []);

  const handleFilterChange = () => {
    fetchMetrics(false);
  };

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground">Loading analytics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-600 rounded-lg">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Assistant Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Monitor assistant action clicks and engagement
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Last updated: {lastUpdated.toLocaleTimeString('es-AR')}
            </span>
          )}
          <button
            onClick={() => fetchMetrics(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            onClick={() => {
              const queryParams = buildQueryParams();
              const suffix = queryParams ? `?${queryParams}` : '';
              window.open(`${API_URL}/api/analytics/export/csv${suffix}`, '_blank');
            }}
            className="flex items-center gap-2 px-4 py-2 border border-border text-foreground rounded-lg text-sm font-medium hover:bg-muted transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
          <button
            onClick={() => {
              const queryParams = buildQueryParams();
              const suffix = queryParams ? `?${queryParams}` : '';
              window.open(`${API_URL}/api/analytics/export/summary-csv${suffix}`, '_blank');
            }}
            className="flex items-center gap-2 px-4 py-2 border border-border text-foreground rounded-lg text-sm font-medium hover:bg-muted transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export Summary
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 p-4 bg-card rounded-xl border border-border">
        <div>
          <label className="text-sm font-medium text-foreground block mb-1">Tenant</label>
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground w-48"
          >
            <option value="">All tenants</option>
            {tenantsList.map((t) => (
              <option key={t.tenantId} value={t.tenantId}>
                {t.tenantId} ({t.eventCount} events)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-foreground block mb-1">Module</label>
          <select
            value={currentModule}
            onChange={(e) => setCurrentModule(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground w-40"
          >
            <option value="">All modules</option>
            <option value="buildings">Buildings</option>
            <option value="units">Units</option>
            <option value="charges">Charges</option>
            <option value="payments">Payments</option>
            <option value="tickets">Tickets</option>
            <option value="reports">Reports</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-foreground block mb-1">Date Range</label>
          <select
            value=""
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              const today = new Date();
              const from = new Date();
              switch (value) {
                case 'today':
                  break;
                case 'last7':
                  from.setDate(today.getDate() - 7);
                  break;
                case 'thisWeek':
                  from.setDate(today.getDate() - today.getDay());
                  break;
                case 'thisMonth':
                  from.setDate(1);
                  break;
                case 'last30':
                  from.setDate(today.getDate() - 30);
                  break;
              }
              const toStr = today.toISOString().split('T')[0];
              const fromStr = from.toISOString().split('T')[0];
              setFromDate(fromStr);
              setToDate(toStr);
            }}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground w-36"
          >
            <option value="">Custom...</option>
            <option value="today">Today</option>
            <option value="last7">Last 7 Days</option>
            <option value="thisWeek">This Week</option>
            <option value="thisMonth">This Month</option>
            <option value="last30">Last 30 Days</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-foreground block mb-1">From Date</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground block mb-1">To Date</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground"
          />
        </div>
        <button
          onClick={handleFilterChange}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Apply Filters
        </button>
        <button
          onClick={() => {
            setTenantId('');
            setCurrentModule('');
            setFromDate('');
            setToDate('');
          }}
          className="px-4 py-2 border border-border text-foreground rounded-lg text-sm font-medium hover:bg-muted transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Overview Cards + Mapped/Unmapped Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-3">
          {hasNoData ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg className="w-12 h-12 text-muted-foreground/50 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.167 10.5a4.5 4.5 0 00-1.5-.813l.846-2.846a4.5 4.5 0 013.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09l2.846.846a4.5 4.5 0 001.5.813z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 6.75l.75.75M6.75 6.75v.75c0 1.035.42 1.985 1.125 2.695l-.75.75m0 0l-.75-.75m.75.75a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <h3 className="text-lg font-medium text-foreground mb-1">No analytics available yet</h3>
              <p className="text-sm text-muted-foreground">
                Assistant events will appear here once users start interacting with the assistant.
              </p>
            </div>
          ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <MetricCard label="Total Events" value={overview?.totalEvents ?? 0} loading={loading && !overview} />
            <MetricCard label="Tenants" value={overview?.uniqueTenants ?? 0} loading={loading && !overview} />
            <MetricCard label="Sessions" value={overview?.uniqueSessions ?? 0} loading={loading && !overview} />
            <MetricCard label="Avg Actions" value={overview?.avgActionsPerMessage ?? 0} unit="%" loading={loading && !overview} />
            <MetricCard label="Mapped Clicks" value={overview?.mappedClicks ?? 0} loading={loading && !overview} />
            <MetricCard label="Unmapped Clicks" value={overview?.unmappedClicks ?? 0} loading={loading && !overview} />
          </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold mb-4">Mapped vs Unmapped Clicks</h2>
          {overview && (overview.mappedClicks + overview.unmappedClicks) > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Mapped', value: overview?.mappedClicks ?? 0 },
                      { name: 'Unmapped', value: overview?.unmappedClicks ?? 0 },
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={60}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    <Cell fill="hsl(var(--primary))" />
                    <Cell fill="hsl(var(--destructive))" />
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    formatter={(value) => (
                      <span style={{ color: 'hsl(var(--foreground))', fontSize: '12px' }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground">
              No click data
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Actions Chart + Table */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold mb-4">Top Actions by Clicks</h2>
          {loading && !actions.length ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground">
              Loading...
            </div>
          ) : actions.length > 0 ? (
            <div className="h-48 mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={actions.slice(0, 5)}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12, fill: 'hsl(var(--foreground))' }} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="actionLabel"
                    tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    width={75}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Bar dataKey="clicks" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                    {actions.slice(0, 5).map((_, index) => (
                      <Cell key={index} fill={`hsl(var(--primary))`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-muted-foreground mb-4">
              No action data
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 font-medium">Action</th>
                  <th className="text-right py-2 font-medium">Clicks</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((action) => (
                  <tr key={action.actionKey} className="border-b border-border/50">
                    <td className="py-2">{action.actionLabel}</td>
                    <td className="text-right font-medium">{action.clicks}</td>
                  </tr>
                ))}
                {actions.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-4 text-center text-muted-foreground">
                      {hasFilters ? 'No results for the selected filters' : 'No action data'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Positions Table */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold mb-4">Clicks by Position</h2>
          {loading && !positions.length ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">
              Loading...
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 font-medium">Position</th>
                  <th className="text-right py-2 font-medium">Clicks</th>
                  <th className="text-right py-2 font-medium">Total Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <tr key={pos.position} className="border-b border-border/50">
                    <td className="py-2">#{pos.position}</td>
                    <td className="text-right font-medium">{pos.clicks}</td>
                    <td className="text-right text-muted-foreground">{pos.totalActions}</td>
                  </tr>
                ))}
                {positions.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-muted-foreground">
                      {hasFilters ? 'No results for the selected filters' : 'No position data'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>

        {/* Tenants Table */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold mb-4">Events by Tenant</h2>
          {loading && !tenants.length ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">
              Loading...
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 font-medium">Tenant</th>
                  <th className="text-right py-2 font-medium">Events</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.tenantId} className="border-b border-border/50">
                    <td className="py-2 font-mono text-xs">{t.tenantId}</td>
                    <td className="text-right font-medium">{t.eventCount}</td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-4 text-center text-muted-foreground">
                      {hasFilters ? 'No results for the selected filters' : 'No tenant data'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>

        {/* Daily Chart */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-lg font-semibold mb-4">Daily Events</h2>
          {loading && !daily.length ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground">
              Loading...
            </div>
          ) : daily.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: 'hsl(var(--foreground))' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: 'hsl(var(--foreground))' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Bar dataKey="eventCount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-muted-foreground">
              {hasFilters ? 'No results for the selected filters' : 'No daily data'}
            </div>
          )}
        </div>

        {/* Module Breakdown */}
        {moduleMetrics.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold mb-4">Metrics by Module</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={moduleMetrics.slice(0, 6)} layout="vertical" margin={{ top: 5, right: 30, left: 60, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="currentModule"
                      tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      width={55}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="totalEvents" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-medium">Module</th>
                      <th className="text-right py-2 font-medium">Events</th>
                      <th className="text-right py-2 font-medium">Useful</th>
                      <th className="text-right py-2 font-medium">Not Use</th>
                      <th className="text-right py-2 font-medium">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moduleMetrics.map((m) => (
                      <tr key={m.currentModule} className="border-b border-border/50">
                        <td className="py-2 capitalize">{m.currentModule || 'unknown'}</td>
                        <td className="text-right font-medium">{m.totalEvents}</td>
                        <td className="text-right text-green-600">{m.usefulCount}</td>
                        <td className="text-right text-red-600">{m.notUsefulCount}</td>
                        <td className="text-right font-medium">{m.usefulRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Feedback Section */}
        {feedback && feedback.totalFeedbacks > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-card rounded-xl border border-border p-6">
              <h2 className="text-lg font-semibold mb-4">Feedback Quality</h2>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-3xl font-bold text-green-600">{feedback.usefulCount}</div>
                  <div className="text-xs text-muted-foreground">Useful</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-red-600">{feedback.notUsefulCount}</div>
                  <div className="text-xs text-muted-foreground">Not Useful</div>
                </div>
                <div>
                  <div className="text-3xl font-bold">{feedback.usefulRate}%</div>
                  <div className="text-xs text-muted-foreground">Useful Rate</div>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border p-6">
              <h2 className="text-lg font-semibold mb-4">Feedback Trend</h2>
              {feedbackDaily.length > 0 ? (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={feedbackDaily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: 'hsl(var(--foreground))' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: 'hsl(var(--foreground))' }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={20}
                        formatter={(value) => (
                          <span style={{ color: 'hsl(var(--foreground))', fontSize: '11px' }}>
                            {value === 'usefulCount' ? 'Useful' : 'Not Useful'}
                          </span>
                        )}
                      />
                      <Line
                        type="monotone"
                        dataKey="usefulCount"
                        stroke="#22c55e"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="notUsefulCount"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-48 flex items-center justify-center text-muted-foreground">
                  No trend data
                </div>
              )}
            </div>

            <div className="bg-card rounded-xl border border-border p-6">
              <h2 className="text-lg font-semibold mb-4">Recent Comments</h2>
              {comments.length > 0 ? (
                <div className="space-y-3 max-h-48 overflow-y-auto">
                  {comments.map((c, i) => (
                    <div key={i} className="border-b border-border/50 pb-2 last:border-0">
                      <p className="text-sm text-foreground">{c.comment}</p>
                      <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
                        <span className="text-red-500">{c.rating === 'not_useful' ? '👎 Not useful' : '👍'}</span>
                        <span>•</span>
                        <span>{c.tenantId}</span>
                        <span>•</span>
                        <span>{new Date(c.createdAt).toLocaleDateString('es-AR')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No comments yet</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, unit, loading }: { label: string; value: number; unit?: string; loading?: boolean }) {
  if (loading) {
    return (
      <div className="bg-card rounded-lg border border-border p-4 animate-pulse">
        <div className="h-3 w-16 bg-muted-foreground/20 rounded mb-2" />
        <div className="h-8 w-12 bg-muted-foreground/20 rounded" />
      </div>
    );
  }
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1">
        {value}
        {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
      </div>
    </div>
  );
}