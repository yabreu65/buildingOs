'use client';

import Badge from '@/shared/components/ui/Badge';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import { AlertCircle } from 'lucide-react';
import type { SubscriptionResponse } from '../services/subscription.api';

interface PlanUsageCardProps {
  billing: SubscriptionResponse;
  onUpgrade?: () => void;
  isLoading?: boolean;
}

/**
 * PlanUsageCard: Displays plan name, status, usage progress bars, and upgrade CTA
 * Shows different colors based on usage percentage
 */
export default function PlanUsageCard({
  billing,
  onUpgrade,
  isLoading = false,
}: PlanUsageCardProps) {
  const { subscription, plan, usage } = billing;

  // Calculate percentages for progress visualization
  const getPercentage = (used: number, limit: number): number => {
    if (limit >= 9999) return 0; // "Unlimited"
    return Math.round((used / limit) * 100);
  };

  // Determine progress bar color based on usage
  const getBarColor = (percentage: number, limit: number): string => {
    if (limit >= 9999) return 'bg-green-500'; // Unlimited
    if (percentage >= 100) return 'bg-red-500'; // Red = limit reached
    if (percentage >= 80) return 'bg-amber-500'; // Orange = warning
    return 'bg-green-500'; // Green = healthy
  };

  // Resource type for display
  interface ResourceItem {
    label: string;
    used: number;
    limit: number;
  }

  const resources: ResourceItem[] = [
    { label: 'Buildings', used: usage.buildings, limit: plan.maxBuildings },
    { label: 'Units', used: usage.units, limit: plan.maxUnits },
    { label: 'Users', used: usage.users, limit: plan.maxUsers },
    { label: 'Residents', used: usage.residents, limit: plan.maxOccupants },
  ];

  // Check if any resource is at/over limit (for warning banner)
  const hasWarning = resources.some(
    (r) => r.limit < 9999 && r.used >= r.limit * 0.9
  );
  const isOverLimit = resources.some(
    (r) => r.limit < 9999 && r.used >= r.limit
  );

  return (
    <Card>
      <div className="space-y-6">
        {/* Header: Plan name + status badge */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {plan.name} Plan
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Status: {subscription.status}
            </p>
          </div>
          <Badge
            className={
              subscription.status === 'ACTIVE'
                ? 'bg-green-100 text-green-800 border-green-300'
                : subscription.status === 'PAST_DUE'
                  ? 'bg-red-100 text-red-800 border-red-300'
                  : 'bg-muted text-muted-foreground border-border'
            }
          >
            {subscription.status}
          </Badge>
        </div>

        {/* PAST_DUE warning banner */}
        {subscription.status === 'PAST_DUE' && (
          <div className="bg-orange-50 border border-orange-200 rounded p-3 flex gap-2">
            <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-orange-800">
              Pago pendiente. Por favor, actualiza tu método de pago para continuar.
            </p>
          </div>
        )}

        {/* Limit reached warning */}
        {isOverLimit && (
          <div className="bg-red-50 border border-red-200 rounded p-3 flex gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">
              Has alcanzado el límite de tu plan actual. Mejora tu plan para continuar.
            </p>
          </div>
        )}

        {/* Usage progress bars */}
        <div className="space-y-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Usage
          </div>
          {resources.map((resource) => {
            const percentage = getPercentage(resource.used, resource.limit);
            const isUnlimited = resource.limit >= 9999;
            const barColor = getBarColor(
              percentage,
              resource.limit
            );

            return (
              <div key={resource.label} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {resource.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {resource.used} / {isUnlimited ? '∞' : resource.limit}
                  </span>
                </div>
                {!isUnlimited && (
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full ${barColor} transition-all`}
                      style={{ width: `${Math.min(percentage, 100)}%` }}
                    />
                  </div>
                )}
                {isUnlimited && (
                  <div className="text-xs text-green-600">Sin límite</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Trial end date info */}
        {subscription.trialEndDate && subscription.status === 'TRIAL' && (
          <p className="text-xs text-amber-600">
            Trial ends:{' '}
            {new Date(subscription.trialEndDate).toLocaleDateString()}
          </p>
        )}

        {/* Upgrade button */}
        {onUpgrade && (
          <div className="pt-2 border-t">
            <Button
              onClick={onUpgrade}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? 'Loading...' : 'Upgrade Plan'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
