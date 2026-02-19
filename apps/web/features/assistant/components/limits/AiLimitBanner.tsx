'use client';

import { AlertCircle, TrendingUp } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import Link from 'next/link';

export interface AiLimitBannerProps {
  type: 'calls_warning' | 'budget_warning' | 'calls_blocked' | 'budget_blocked';
  percentUsed: number;
  upgradeHref: string;
}

/**
 * Phase 13: Banner showing AI limit warnings and blocks
 * - Yellow (warning) at 80% threshold
 * - Red (blocked) at 100%
 */
export function AiLimitBanner({
  type,
  percentUsed,
  upgradeHref,
}: AiLimitBannerProps) {
  const isWarning = type.includes('warning');
  const isBlocked = type.includes('blocked');
  const isCalls = type.includes('calls');

  const bgColor = isBlocked ? 'bg-red-50' : 'bg-amber-50';
  const borderColor = isBlocked ? 'border-red-200' : 'border-amber-200';
  const iconColor = isBlocked ? 'text-red-600' : 'text-amber-600';
  const textColor = isBlocked ? 'text-red-800' : 'text-amber-800';

  const title = isBlocked
    ? isCalls
      ? 'Monthly AI Calls Limit Reached'
      : 'Monthly AI Budget Exceeded'
    : isCalls
    ? 'Using Most of Your Monthly AI Calls'
    : 'Using Most of Your Monthly AI Budget';

  const description = isBlocked
    ? isCalls
      ? "You've reached your monthly limit of AI calls. Consider upgrading your plan for more capacity."
      : "You've exceeded your monthly AI budget. Responses are being limited. Consider upgrading your plan."
    : isCalls
    ? `You've used ${percentUsed.toFixed(0)}% of your monthly AI calls limit.`
    : `You've used ${percentUsed.toFixed(0)}% of your monthly AI budget.`;

  return (
    <div className={`${bgColor} ${borderColor} border rounded-lg p-4 flex items-start gap-3`}>
      <AlertCircle className={`${iconColor} mt-0.5 flex-shrink-0`} size={20} />
      <div className="flex-1">
        <h3 className={`${textColor} font-semibold text-sm mb-1`}>{title}</h3>
        <p className={`${textColor} text-sm opacity-90 mb-3`}>{description}</p>
        <Link href={upgradeHref}>
          <Button
            variant="secondary"
            size="sm"
            className={isBlocked ? 'text-red-700' : 'text-amber-700'}
          >
            <TrendingUp size={16} className="mr-2" />
            Upgrade Plan
          </Button>
        </Link>
      </div>
    </div>
  );
}
