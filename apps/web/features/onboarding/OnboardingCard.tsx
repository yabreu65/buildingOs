'use client';

import { useState } from 'react';
import Link from 'next/link';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import { useOnboarding } from './useOnboarding';

interface OnboardingCardProps {
  tenantId: string;
  className?: string;
}

export default function OnboardingCard({ tenantId, className = '' }: OnboardingCardProps) {
  const { steps, loading, isDismissed, completionPercentage, dismiss } =
    useOnboarding(tenantId);
  const [isDismissing, setIsDismissing] = useState(false);

  if (!tenantId || loading) {
    return null;
  }

  // Hide if dismissed or all steps are complete
  if (isDismissed || completionPercentage === 100) {
    return null;
  }

  const visibleSteps = steps.filter((s) => s.category === 'tenant');
  const completedSteps = visibleSteps.filter((s) => s.status === 'DONE').length;

  const handleDismiss = async () => {
    setIsDismissing(true);
    try {
      await dismiss();
    } finally {
      setIsDismissing(false);
    }
  };

  return (
    <Card className={`p-6 mb-8 border-l-4 border-l-blue-500 ${className}`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Checklist de Configuración</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Completa estos pasos para aprovechar al máximo BuildingOS.
          </p>
        </div>

        <div className="text-right">
          <span className="text-2xl font-bold text-blue-600">{completionPercentage}%</span>
          <p className="text-xs text-muted-foreground">Completado</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-muted h-2 rounded-full mb-4 overflow-hidden">
        <div
          className="bg-blue-500 h-full transition-all duration-300"
          style={{ width: `${completionPercentage}%` }}
        />
      </div>

      {/* Steps list */}
      <div className="space-y-3 mb-4">
        {visibleSteps.map((step) => (
          <div
            key={step.id}
            className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
              step.status === 'DONE'
                ? 'bg-muted/40 border-border'
                : 'bg-card border-border hover:border-blue-500/40'
            }`}
          >
            <div className="flex items-center gap-3 flex-1">
              {/* Status indicator */}
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                  step.status === 'DONE'
                    ? 'bg-green-500/15 text-green-600'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {step.status === 'DONE' ? (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                )}
              </div>

              {/* Step info */}
              <div>
                <h3
                  className={`font-medium text-sm ${
                    step.status === 'DONE'
                      ? 'text-muted-foreground line-through'
                      : 'text-foreground'
                  }`}
                >
                  {step.label}
                </h3>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
            </div>

            {/* CTA button */}
            {step.status === 'TODO' && (
              <Link href={`/${tenantId}/buildings`} className="flex-shrink-0 ml-3">
                <Button variant="secondary" size="sm">
                  Ir
                </Button>
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Dismiss button */}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          disabled={isDismissing}
        >
          Descartar
        </Button>
      </div>
    </Card>
  );
}
