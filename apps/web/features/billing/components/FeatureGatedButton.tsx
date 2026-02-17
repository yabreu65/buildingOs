'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import FeatureUnavailableModal from './FeatureUnavailableModal';
import { hasFeature, type PlanFeatures } from '../hooks/useSubscription';

interface FeatureGatedButtonProps {
  features: PlanFeatures | null;
  featureKey: keyof PlanFeatures;
  requiredPlan?: string;
  onUpgradeClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  [key: string]: any; // Allow spreading Button props
}

/**
 * Button component that gates visibility/ability based on feature availability
 *
 * Usage:
 * ```tsx
 * <FeatureGatedButton
 *   features={features}
 *   featureKey="canExportReports"
 *   requiredPlan="BASIC"
 *   onClick={handleExport}
 * >
 *   Export Reports
 * </FeatureGatedButton>
 * ```
 *
 * If feature not available:
 * - Button is disabled
 * - Tooltip shows feature is locked
 * - Click shows modal explaining what plan is needed
 */
export default function FeatureGatedButton({
  features,
  featureKey,
  requiredPlan = 'PRO',
  onUpgradeClick,
  disabled = false,
  children,
  ...buttonProps
}: FeatureGatedButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const isAvailable = hasFeature(features, featureKey);

  // If feature is available and no other disable condition, render normal button
  if (isAvailable) {
    return (
      <Button disabled={disabled} {...buttonProps}>
        {children}
      </Button>
    );
  }

  // Feature not available - render disabled button with lock indicator
  return (
    <>
      <div className="relative group">
        <Button
          disabled
          {...buttonProps}
          onClick={() => setShowModal(true)}
        >
          {children}
        </Button>

        {/* Tooltip on hover */}
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          Available on {requiredPlan} plan
        </div>
      </div>

      {showModal && (
        <FeatureUnavailableModal
          featureKey={featureKey as string}
          requiredPlan={requiredPlan}
          onClose={() => setShowModal(false)}
          onUpgradeClick={onUpgradeClick}
        />
      )}
    </>
  );
}
