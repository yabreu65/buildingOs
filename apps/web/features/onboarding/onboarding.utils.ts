import { ManualCompletionMap, OnboardingStep } from "./onboarding.types";

/**
 * Fusiona el estado calculado automáticamente con las completaciones manuales.
 * La lógica es:
 * 1. Si el paso está completado automáticamente (data real), es DONE.
 * 2. Si el paso permite override manual Y está marcado manual, es DONE.
 * 3. Si no, es TODO.
 */
export function mergeStepStatus(
  steps: OnboardingStep[],
  autoComputedStatus: Record<string, boolean>,
  manualCompletions: ManualCompletionMap
): OnboardingStep[] {
  return steps.map((step) => {
    const autoDone = autoComputedStatus[step.id] === true;
    const manualDone = manualCompletions[step.id] === true;

    // Lógica de merge:
    // - Auto siempre gana si es true.
    // - Manual gana si es true Y está permitido el override.
    // - Sino TODO.
    
    // Nota: Si queremos que manual pueda marcar como TODO algo que auto dice DONE,
    // necesitaríamos una lógica más compleja (ej: manual override explicit false).
    // Por ahora asumimos aditivo: Auto OR Manual.

    let isDone = autoDone;

    if (!isDone && step.isManualOverrideAllowed && manualDone) {
      isDone = true;
    }

    return {
      ...step,
      status: isDone ? "DONE" : "TODO",
    };
  });
}
