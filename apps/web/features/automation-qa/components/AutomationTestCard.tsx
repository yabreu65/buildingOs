'use client';

import Link from 'next/link';
import { Loader2, PlayCircle, CheckCircle2, AlertCircle, Clock3, Circle } from 'lucide-react';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import Badge from '@/shared/components/ui/Badge';
import type {
  AutomationTestDefinition,
  AutomationTestStatus,
} from '../data/automation-tests';

interface AutomationTestCardProps {
  test: AutomationTestDefinition;
  status: AutomationTestStatus;
  note?: string;
  onStatusChange: (status: AutomationTestStatus) => void;
  onNoteChange: (note: string) => void;
  onTrigger: () => Promise<void>;
  isTriggering: boolean;
  actionHref: string;
  evidenceHref: string;
}

function statusLabel(status: AutomationTestStatus): string {
  const labels: Record<AutomationTestStatus, string> = {
    pending: 'Pendiente',
    in_progress: 'En progreso',
    passed: 'Aprobada',
    failed: 'Fallida',
  };
  return labels[status];
}

function statusClassName(status: AutomationTestStatus): string {
  const classNames: Record<AutomationTestStatus, string> = {
    pending: 'bg-muted text-muted-foreground border border-border',
    in_progress: 'bg-blue-100 text-blue-800 border border-blue-200',
    passed: 'bg-green-100 text-green-800 border border-green-200',
    failed: 'bg-red-100 text-red-800 border border-red-200',
  };
  return classNames[status];
}

export function AutomationTestCard({
  test,
  status,
  note,
  onStatusChange,
  onNoteChange,
  onTrigger,
  isTriggering,
  actionHref,
  evidenceHref,
}: AutomationTestCardProps) {
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{test.code}</p>
          <h3 className="text-base font-semibold">{test.title}</h3>
        </div>
        <Badge className={statusClassName(status)}>{statusLabel(status)}</Badge>
      </div>

      <p className="text-sm text-muted-foreground">{test.objective}</p>

      <div className="flex flex-wrap gap-2">
        <Link href={actionHref}>
          <Button size="sm" variant="secondary">
            <PlayCircle className="mr-1 h-4 w-4" />
            {test.actionLabel}
          </Button>
        </Link>
        <Link href={evidenceHref}>
          <Button size="sm" variant="secondary">
            <CheckCircle2 className="mr-1 h-4 w-4" />
            {test.evidenceLabel}
          </Button>
        </Link>
        {test.triggerKey ? (
          <Button size="sm" onClick={() => void onTrigger()} disabled={isTriggering}>
            {isTriggering ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Clock3 className="mr-1 h-4 w-4" />}
            Ejecutar trigger
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Button
          variant={status === 'pending' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => onStatusChange('pending')}
        >
          <Circle className="mr-1 h-4 w-4" />
          Pendiente
        </Button>
        <Button
          variant={status === 'in_progress' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => onStatusChange('in_progress')}
        >
          <Clock3 className="mr-1 h-4 w-4" />
          En progreso
        </Button>
        <Button
          variant={status === 'passed' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => onStatusChange('passed')}
        >
          <CheckCircle2 className="mr-1 h-4 w-4" />
          Aprobada
        </Button>
        <Button
          variant={status === 'failed' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => onStatusChange('failed')}
        >
          <AlertCircle className="mr-1 h-4 w-4" />
          Fallida
        </Button>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Notas de evidencia</label>
        <textarea
          value={note || ''}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={2}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="Ej. Notificacion visible a las 10:24 y cargo marcado como overdue"
        />
      </div>
    </Card>
  );
}
