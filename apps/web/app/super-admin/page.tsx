'use client';

import Link from 'next/link';
import Card from '@/shared/components/ui/Card';

export default function SuperAdminDashboard() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Control Plane</h1>
        <p className="text-muted-foreground mt-2">
          Manage your BuildingOS SaaS platform
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Tenants Card */}
        <Link href="/super-admin/tenants">
          <Card className="h-32 flex flex-col justify-between hover:bg-accent/5 cursor-pointer transition-colors">
            <div>
              <h2 className="text-xl font-semibold">Tenants</h2>
              <p className="text-sm text-muted-foreground">
                Manage all customer organizations
              </p>
            </div>
            <div className="text-2xl font-bold text-primary">→</div>
          </Card>
        </Link>

        {/* Overview/Stats Card */}
        <Link href="/super-admin/overview">
          <Card className="h-32 flex flex-col justify-between hover:bg-accent/5 cursor-pointer transition-colors">
            <div>
              <h2 className="text-xl font-semibold">Overview</h2>
              <p className="text-sm text-muted-foreground">
                View platform statistics and metrics
              </p>
            </div>
            <div className="text-2xl font-bold text-primary">→</div>
          </Card>
        </Link>

        {/* Audit Logs Card */}
        <Link href="/super-admin/audit-logs">
          <Card className="h-32 flex flex-col justify-between hover:bg-accent/5 cursor-pointer transition-colors">
            <div>
              <h2 className="text-xl font-semibold">Audit Logs</h2>
              <p className="text-sm text-muted-foreground">
                Track platform activity and compliance
              </p>
            </div>
            <div className="text-2xl font-bold text-primary">→</div>
          </Card>
        </Link>

        {/* Platform Users Card (Coming Soon) */}
        <Card className="h-32 flex flex-col justify-between opacity-50">
          <div>
            <h2 className="text-xl font-semibold">Platform Users</h2>
            <p className="text-sm text-muted-foreground">
              Manage global super admin users
            </p>
          </div>
          <div className="text-xs font-semibold text-primary uppercase">Coming Soon</div>
        </Card>
      </div>
    </div>
  );
}
