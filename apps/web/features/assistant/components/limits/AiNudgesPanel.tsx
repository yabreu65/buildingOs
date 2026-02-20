'use client';

import Link from 'next/link';
import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { AiNudge } from '../../services/ai-nudges.api';

interface AiNudgesPanelProps {
  nudges: AiNudge[];
  loading?: boolean;
  submitting?: boolean;
  onDismiss: (key: AiNudge['key']) => Promise<void> | void;
  onRequestUpgrade: () => Promise<unknown> | void;
}

const severityStyles: Record<
  AiNudge['severity'],
  { card: string; title: string; badge: string }
> = {
  BLOCK: {
    card: 'border-red-300 bg-red-50',
    title: 'text-red-900',
    badge: 'bg-red-100 text-red-700',
  },
  WARN: {
    card: 'border-amber-300 bg-amber-50',
    title: 'text-amber-900',
    badge: 'bg-amber-100 text-amber-700',
  },
  INFO: {
    card: 'border-blue-300 bg-blue-50',
    title: 'text-blue-900',
    badge: 'bg-blue-100 text-blue-700',
  },
};

export function AiNudgesPanel({
  nudges,
  loading = false,
  submitting = false,
  onDismiss,
  onRequestUpgrade,
}: AiNudgesPanelProps) {
  const [actionError, setActionError] = useState<string | null>(null);

  const handleCta = async (nudge: AiNudge, action: string) => {
    setActionError(null);
    if (action === 'REQUEST_UPGRADE_RECOMMENDED') {
      try {
        await onRequestUpgrade();
      } catch {
        setActionError('No se pudo crear la solicitud de upgrade.');
      }
      return;
    }

    if (action === 'OPEN_SUPPORT' || action === 'REQUEST_TEMP_OVERRIDE') {
      return;
    }

    if (action === 'OPEN_AI_SETTINGS') {
      return;
    }

    console.warn('Unsupported AI nudge action:', action, nudge.key);
  };

  if (loading) {
    return (
      <Card className="p-4 border border-gray-200">
        <p className="text-sm text-gray-600">Cargando recomendaciones de IA...</p>
      </Card>
    );
  }

  if (nudges.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {actionError && (
        <Card className="border-red-300 bg-red-50">
          <p className="text-sm text-red-700">{actionError}</p>
        </Card>
      )}

      {nudges.map((nudge) => {
        const style = severityStyles[nudge.severity];
        return (
          <Card key={nudge.key} className={`${style.card} p-4`}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <p className={`font-semibold text-sm ${style.title}`}>{nudge.title}</p>
                <p className="text-sm text-gray-700 mt-1">{nudge.message}</p>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${style.badge}`}>
                {nudge.severity}
              </span>
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              {nudge.ctas.map((cta) => {
                if (cta.href) {
                  return (
                    <Link key={`${nudge.key}:${cta.action}:${cta.label}`} href={cta.href}>
                      <Button size="sm" variant="secondary">
                        {cta.label}
                      </Button>
                    </Link>
                  );
                }

                return (
                  <Button
                    key={`${nudge.key}:${cta.action}:${cta.label}`}
                    size="sm"
                    variant="secondary"
                    disabled={submitting}
                    onClick={() => {
                      void handleCta(nudge, cta.action);
                    }}
                  >
                    {cta.label}
                  </Button>
                );
              })}

              {nudge.dismissible && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={submitting}
                  onClick={() => {
                    void onDismiss(nudge.key);
                  }}
                >
                  Cerrar 7 dias
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
