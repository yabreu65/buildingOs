'use client';

import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { X, Lock } from 'lucide-react';
import { useState } from 'react';

interface FeatureUnavailableModalProps {
  featureKey: string;
  requiredPlan?: string;
  onClose: () => void;
  onUpgradeClick?: () => void;
}

/**
 * Modal shown when user tries to access a feature not available on their plan
 */
export default function FeatureUnavailableModal({
  featureKey,
  requiredPlan = 'PRO',
  onClose,
  onUpgradeClick,
}: FeatureUnavailableModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <Lock className="w-6 h-6 text-amber-600" />
            <h2 className="text-lg font-semibold text-foreground">
              Feature Not Available
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          The feature <strong>{formatFeatureName(featureKey)}</strong> is not available on your current plan.
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-6">
          <p className="text-sm text-amber-800">
            To unlock this feature, please upgrade to the{' '}
            <strong>{requiredPlan}</strong> plan or higher.
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          {onUpgradeClick && (
            <Button onClick={onUpgradeClick} className="flex-1">
              Upgrade Plan
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

/**
 * Convert feature key to human-readable name
 */
function formatFeatureName(key: string): string {
  return key
    .replace(/^can/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
