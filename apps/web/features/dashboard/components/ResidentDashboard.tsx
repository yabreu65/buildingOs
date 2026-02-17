'use client';

import Card from '@/shared/components/ui/Card';
import Badge from '@/shared/components/ui/Badge';
import Skeleton from '@/shared/components/ui/Skeleton';
import EmptyState from '@/shared/components/ui/EmptyState';
import { useUnits } from '@/features/buildings/hooks/useUnits';
import { Home } from 'lucide-react';

interface ResidentDashboardProps {
  tenantId: string;
  userId: string;
}

export default function ResidentDashboard({
  tenantId,
  userId,
}: ResidentDashboardProps) {
  // For residents, we would need to fetch their assigned unit from the API
  // For now, showing a simplified view

  return (
    <div className="space-y-8">
      {/* Welcome Card */}
      <Card>
        <h2 className="text-2xl font-semibold text-foreground mb-2">
          Welcome, Resident
        </h2>
        <p className="text-muted-foreground">
          Here's an overview of your unit and property information
        </p>
      </Card>

      {/* Your Unit Card */}
      <Card>
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Your Unit
        </h3>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">Status</label>
            <Badge className="mt-1 bg-green-100 text-green-800 border-green-300">
              Active
            </Badge>
          </div>

          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              Contact your building administrator for unit-specific details or maintenance requests.
            </p>
          </div>
        </div>
      </Card>

      {/* Shortcuts */}
      <Card>
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Quick Actions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg cursor-pointer hover:bg-muted/80 transition">
            <Home className="w-5 h-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Building Info</div>
              <div className="text-xs text-muted-foreground">View your building details</div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg cursor-pointer hover:bg-muted/80 transition">
            <Home className="w-5 h-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Support</div>
              <div className="text-xs text-muted-foreground">Contact administrator</div>
            </div>
          </div>
        </div>
      </Card>

      {/* Info Card */}
      <Card className="bg-amber-50 border-amber-200">
        <div className="flex items-start gap-3">
          <div className="w-1 h-1 rounded-full bg-amber-600 mt-2 flex-shrink-0" />
          <div>
            <h4 className="font-semibold text-amber-900">Resident View</h4>
            <p className="text-sm text-amber-700">
              As a resident, your access is limited to your unit and building information. For additional help, contact your building administrator.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
