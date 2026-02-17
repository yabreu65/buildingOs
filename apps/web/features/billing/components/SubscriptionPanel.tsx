'use client';

import { useCallback, useState, useEffect } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import ErrorState from '@/shared/components/ui/ErrorState';
import Skeleton from '@/shared/components/ui/Skeleton';
import PlanUsageCard from './PlanUsageCard';
import {
  fetchTenantBillingAdmin,
  changePlanAdmin,
  type SubscriptionResponse,
} from '../services/subscription.api';

interface SubscriptionPanelProps {
  tenantId: string;
}

const PLAN_OPTIONS = ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'];

/**
 * SubscriptionPanel: Super-admin view for managing a tenant's subscription
 * Shows current plan usage and allows changing to another plan
 */
export default function SubscriptionPanel({ tenantId }: SubscriptionPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState<SubscriptionResponse | null>(null);
  const [isChangingPlan, setIsChangingPlan] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [showPlanModal, setShowPlanModal] = useState(false);

  // Fetch billing data on mount or tenantId change
  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTenantBillingAdmin(tenantId);
      setBilling(data);
      setSelectedPlan(data.plan.planId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch billing');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Handle plan change
  const handleChangePlan = useCallback(async () => {
    if (!selectedPlan || selectedPlan === billing?.plan.planId) {
      setShowPlanModal(false);
      return;
    }

    setIsChangingPlan(true);
    try {
      await changePlanAdmin(tenantId, selectedPlan);
      toast(`Plan changed to ${selectedPlan}`, 'success');
      setShowPlanModal(false);
      await refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change plan';
      toast(message, 'error');
    } finally {
      setIsChangingPlan(false);
    }
  }, [selectedPlan, billing?.plan.planId, tenantId, toast, refetch]);

  if (loading && !billing) {
    return (
      <Card>
        <div className="space-y-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </Card>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={refetch} />;
  }

  if (!billing) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">
          Subscription Management
        </h2>
        <Button
          onClick={() => setShowPlanModal(true)}
          variant="secondary"
          size="sm"
        >
          Change Plan
        </Button>
      </div>

      <PlanUsageCard
        billing={billing}
        isLoading={isChangingPlan}
      />

      {/* Plan Change Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground">
                Change Plan
              </h3>
              <p className="text-sm text-muted-foreground">
                Current plan: <strong>{billing.plan.planId}</strong>
              </p>

              {/* Plan options */}
              <div className="space-y-2">
                {PLAN_OPTIONS.map((planId) => (
                  <label
                    key={planId}
                    className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted transition-colors"
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={planId}
                      checked={selectedPlan === planId}
                      onChange={(e) => setSelectedPlan(e.target.value)}
                      disabled={isChangingPlan}
                    />
                    <span className="text-sm font-medium text-foreground">
                      {planId}
                    </span>
                  </label>
                ))}
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  variant="secondary"
                  onClick={() => setShowPlanModal(false)}
                  disabled={isChangingPlan}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleChangePlan}
                  disabled={
                    isChangingPlan ||
                    selectedPlan === billing.plan.planId
                  }
                  className="flex-1"
                >
                  {isChangingPlan ? 'Changing...' : 'Confirm'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
