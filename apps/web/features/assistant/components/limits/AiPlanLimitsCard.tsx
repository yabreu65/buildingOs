'use client';

import { Card, Badge } from '@/shared/components/ui';
import { EffectiveLimits, AiUsageData } from '../../hooks/useAiLimits';

export interface AiPlanLimitsCardProps {
  planName: string;
  limits: EffectiveLimits;
  usage: AiUsageData;
}

/**
 * Phase 13: Card showing plan AI limits and current usage
 * Displays budget, calls limit, and advanced model access
 */
export function AiPlanLimitsCard({
  planName,
  limits,
  usage,
}: AiPlanLimitsCardProps) {
  const budgetDollars = (limits.budgetCents / 100).toFixed(2);
  const usedDollars = (usage.estimatedCostCents / 100).toFixed(2);
  const callsRemaining = Math.max(0, limits.callsLimit - usage.calls);

  // Color coding for progress bars
  const getBudgetColor = (percent: number) => {
    if (percent >= 100) return 'bg-red-600';
    if (percent >= 80) return 'bg-amber-500';
    return 'bg-green-600';
  };

  const getCallsColor = (percent: number) => {
    if (percent >= 100) return 'bg-red-600';
    if (percent >= 80) return 'bg-amber-500';
    return 'bg-blue-600';
  };

  const budgetPercent = limits.budgetCents === 0 ? 0 : (usage.estimatedCostCents / limits.budgetCents) * 100;
  const callsPercent = usage.callsPercent;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">AI Plan: {planName}</h3>
        {limits.allowBigModel && (
          <Badge className="text-xs">Advanced Models</Badge>
        )}
      </div>
      <p className="text-sm text-gray-600 mb-6">Monthly usage and limits</p>

      <div className="space-y-6">
        {/* Budget Section */}
        {limits.budgetCents > 0 && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">Monthly Budget</span>
              <span className="text-sm text-gray-600">
                ${usedDollars} / ${budgetDollars}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${getBudgetColor(budgetPercent)}`}
                style={{ width: `${Math.min(100, budgetPercent)}%` }}
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">
              {budgetPercent.toFixed(0)}% used
            </p>
          </div>
        )}

        {/* Calls Limit Section */}
        {limits.callsLimit > 0 && limits.callsLimit < 9999 && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">Monthly Calls</span>
              <span className="text-sm text-gray-600">
                {usage.calls} / {limits.callsLimit}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${getCallsColor(callsPercent)}`}
                style={{ width: `${Math.min(100, callsPercent)}%` }}
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">
              {callsRemaining} calls remaining ({callsPercent.toFixed(0)}% used)
            </p>
          </div>
        )}

        {/* Unlimited Indicators */}
        {limits.callsLimit === 0 && (
          <div className="p-2 bg-blue-50 rounded-md">
            <p className="text-xs text-blue-800">No AI access on this plan</p>
          </div>
        )}

        {limits.callsLimit >= 9999 && (
          <div className="p-2 bg-blue-50 rounded-md">
            <p className="text-xs text-blue-800">Unlimited monthly AI calls</p>
          </div>
        )}

        {!limits.allowBigModel && (
          <div className="p-2 bg-amber-50 rounded-md">
            <p className="text-xs text-amber-800">
              Basic AI models only (upgrade to PRO for advanced models)
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
