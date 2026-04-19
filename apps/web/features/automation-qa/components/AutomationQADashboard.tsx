'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { RotateCcw, Gauge, CheckCircle2, AlertTriangle } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import {
  automationTests,
  type AutomationTestStatus,
} from '../data/automation-tests';
import { AutomationTestCard } from './AutomationTestCard';
import { triggerAutomationCron, type CronTriggerKey } from '../services/automation-qa.api';

interface AutomationTestState {
  status: AutomationTestStatus;
  note: string;
}

type AutomationStateMap = Record<number, AutomationTestState>;

interface AutomationQADashboardProps {
  tenantId: string;
  buildingId: string;
}

function getStorageKey(tenantId: string, buildingId: string): string {
  return `automation-qa:${tenantId}:${buildingId}`;
}

function loadInitialState(tenantId: string, buildingId: string): AutomationStateMap {
  if (typeof window === 'undefined') {
    return {};
  }

  const raw = window.localStorage.getItem(getStorageKey(tenantId, buildingId));
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as AutomationStateMap;
  } catch {
    return {};
  }
}

export function AutomationQADashboard({ tenantId, buildingId }: AutomationQADashboardProps) {
  const { toast } = useToast();
  const [stateMap, setStateMap] = useState<AutomationStateMap>(() =>
    loadInitialState(tenantId, buildingId),
  );
  const [triggeringTestId, setTriggeringTestId] = useState<number | null>(null);

  const persistState = (nextState: AutomationStateMap) => {
    setStateMap(nextState);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(getStorageKey(tenantId, buildingId), JSON.stringify(nextState));
    }
  };

  const triggerMutation = useMutation({
    mutationFn: ({ triggerKey }: { triggerKey: CronTriggerKey }) => {
      return triggerAutomationCron(tenantId, buildingId, triggerKey);
    },
  });

  const stats = useMemo(() => {
    const totals = {
      pending: 0,
      inProgress: 0,
      passed: 0,
      failed: 0,
    };

    automationTests.forEach((test) => {
      const status = stateMap[test.id]?.status || 'pending';
      if (status === 'pending') totals.pending += 1;
      if (status === 'in_progress') totals.inProgress += 1;
      if (status === 'passed') totals.passed += 1;
      if (status === 'failed') totals.failed += 1;
    });

    return totals;
  }, [stateMap]);

  const completionRate = Math.round((stats.passed / automationTests.length) * 100);

  const updateTestState = (
    testId: number,
    patch: Partial<AutomationTestState>,
  ) => {
    const current = stateMap[testId] || { status: 'pending' as AutomationTestStatus, note: '' };
    const nextState: AutomationStateMap = {
      ...stateMap,
      [testId]: {
        ...current,
        ...patch,
      },
    };
    persistState(nextState);
  };

  const handleReset = () => {
    persistState({});
    toast('Checklist reiniciada para este edificio', 'success');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Automation QA</h1>
          <p className="text-sm text-muted-foreground">
            Ejecuta y evidencia las 15 automatizaciones en un solo tablero.
          </p>
        </div>
        <Button variant="secondary" onClick={handleReset}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reiniciar estado
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Progreso</p>
          <p className="mt-1 text-2xl font-bold">{completionRate}%</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Pendientes</p>
          <p className="mt-1 text-2xl font-bold">{stats.pending}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Aprobadas</p>
          <p className="mt-1 text-2xl font-bold text-green-700">{stats.passed}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Fallidas</p>
          <p className="mt-1 text-2xl font-bold text-red-700">{stats.failed}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
        <Gauge className="h-4 w-4" />
        <span>Los triggers manuales requieren entorno development o staging.</span>
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <span>El estado se guarda por tenant y building.</span>
        <AlertTriangle className="h-4 w-4 text-orange-600" />
        <span>Validar evidencias desde Notificaciones y pantallas de negocio.</span>
      </div>

      <div className="space-y-4">
        {automationTests.map((test) => {
          const current = stateMap[test.id] || { status: 'pending' as AutomationTestStatus, note: '' };
          const actionHref = `/${tenantId}/buildings/${buildingId}${test.frontPath}`;
          const evidenceHref =
            test.evidencePath.startsWith('/resident') || test.evidencePath.startsWith('/notifications')
              ? `/${tenantId}${test.evidencePath}`
              : `/${tenantId}/buildings/${buildingId}${test.evidencePath}`;

          return (
            <AutomationTestCard
              key={test.id}
              test={test}
              status={current.status}
              note={current.note}
              actionHref={actionHref}
              evidenceHref={evidenceHref}
              isTriggering={triggeringTestId === test.id && triggerMutation.isPending}
              onStatusChange={(status) => updateTestState(test.id, { status })}
              onNoteChange={(note) => updateTestState(test.id, { note })}
              onTrigger={async () => {
                if (!test.triggerKey) {
                  toast('Este caso no tiene trigger manual', 'error');
                  return;
                }

                setTriggeringTestId(test.id);
                try {
                  const response = await triggerMutation.mutateAsync({
                    triggerKey: test.triggerKey,
                  });

                  if (response.success) {
                    toast(`Trigger ejecutado en ${response.durationMs}ms. Verificá la evidencia y marcá manualmente como Aprobada o Fallida.`, 'success', 5000);
                    updateTestState(test.id, {
                      status: 'in_progress', // Manual verification required
                      note: `${current.note ? current.note + ' | ' : ''}Trigger OK ${new Date().toLocaleTimeString('es-AR')}`,
                    });
                  } else {
                    toast(response.error || 'Trigger falló', 'error');
                    updateTestState(test.id, {
                      status: 'failed',
                      note: `${current.note ? current.note + ' | ' : ''}Error: ${response.error} ${new Date().toLocaleTimeString('es-AR')}`,
                    });
                  }
                } catch (error) {
                  toast(error instanceof Error ? error.message : 'Error al ejecutar trigger', 'error');
                  updateTestState(test.id, {
                    status: 'failed',
                    note: `${current.note ? current.note + ' | ' : ''}Excepción: ${error instanceof Error ? error.message : 'Error desconocido'} ${new Date().toLocaleTimeString('es-AR')}`,
                  });
                } finally {
                  setTriggeringTestId(null);
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
