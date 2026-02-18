'use client';

import { useState, useEffect } from 'react';
import Card from '@/shared/components/ui/Card';
import { getBuildingSteps, type BuildingStep } from './onboarding.api';

interface BuildingOnboardingCardProps {
  tenantId: string;
  buildingId: string;
  className?: string;
}

export default function BuildingOnboardingCard({
  tenantId,
  buildingId,
  className = '',
}: BuildingOnboardingCardProps) {
  const [steps, setSteps] = useState<BuildingStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completionPercentage, setCompletionPercentage] = useState(0);
  const [buildingName, setBuildingName] = useState('');

  useEffect(() => {
    const fetchSteps = async () => {
      if (!tenantId || !buildingId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const data = await getBuildingSteps(tenantId, buildingId);

        setSteps(data.steps);
        setBuildingName(data.buildingName);
        setCompletionPercentage(data.completionPercentage);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch building steps');
      } finally {
        setLoading(false);
      }
    };

    fetchSteps();
  }, [tenantId, buildingId]);

  if (!tenantId || !buildingId || loading) {
    return null;
  }

  if (error) {
    return (
      <Card className={`p-4 mb-6 border border-red-200 bg-red-50 ${className}`}>
        <p className="text-sm text-red-700">Error: {error}</p>
      </Card>
    );
  }

  // Hide if all steps are complete
  if (completionPercentage === 100) {
    return null;
  }

  const completedSteps = steps.filter((s) => s.status === 'DONE').length;

  return (
    <Card className={`p-6 mb-6 border-l-4 border-l-amber-500 ${className}`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-bold text-foreground">
            Configuración de {buildingName}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {completedSteps} de {steps.length} pasos completados
          </p>
        </div>

        <div className="text-right">
          <span className="text-2xl font-bold text-amber-600">{completionPercentage}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-muted h-2 rounded-full mb-4 overflow-hidden">
        <div
          className="bg-amber-500 h-full transition-all duration-300"
          style={{ width: `${completionPercentage}%` }}
        />
      </div>

      {/* Steps list */}
      <div className="space-y-2">
        {steps.map((step) => (
          <div
            key={step.id}
            className={`flex items-center gap-3 p-3 rounded-lg ${
              step.status === 'DONE'
                ? 'bg-muted/40 text-muted-foreground'
                : 'bg-card text-foreground'
            }`}
          >
            {/* Status indicator */}
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium ${
                step.status === 'DONE'
                  ? 'bg-green-500/15 text-green-600'
                  : 'bg-amber-500/15 text-amber-600'
              }`}
            >
              {step.status === 'DONE' ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : (
                <span>•</span>
              )}
            </div>

            {/* Step label */}
            <span className="text-sm font-medium">{step.label}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
