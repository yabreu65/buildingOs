import { useState, useEffect, useCallback, useRef } from "react";
import { fetchManualProgress, updateManualProgress } from "./onboarding.service";
import { ManualCompletionMap } from "./onboarding.types";

export function useTenantOnboarding(tenantId: string) {
  const [manualCompletions, setManualCompletions] = useState<ManualCompletionMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Evitar escrituras en el primer render o durante la carga inicial
  const isFirstLoad = useRef(true);

  // 1) Cargar progreso manual al montar o cambiar tenantId
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    isFirstLoad.current = true;

    fetchManualProgress(tenantId)
      .then((data) => {
        if (mounted) {
          setManualCompletions(data.manualCompletions);
          setLoading(false);
          // Permitir persistencia solo después de cargar
          setTimeout(() => {
             if (mounted) isFirstLoad.current = false;
          }, 0);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err);
          setLoading(false);
          isFirstLoad.current = false;
        }
      });

    return () => {
      mounted = false;
    };
  }, [tenantId]);

  // 2) Persistir cambios manuales con debounce
  useEffect(() => {
    // No persistir si estamos cargando o es la carga inicial
    if (loading || isFirstLoad.current) return;

    const timer = setTimeout(() => {
      updateManualProgress(tenantId, manualCompletions).catch((err) => {
        console.error("Failed to persist onboarding progress", err);
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [manualCompletions, tenantId, loading]);

  // 3) Handler para toggles manuales (optimistic update)
  const toggleStep = useCallback((stepId: string) => {
    setManualCompletions((prev) => {
      const current = prev[stepId] ?? false;
      return {
        ...prev,
        [stepId]: !current,
      };
    });
  }, []);

  return {
    manualCompletions,
    loading,
    error,
    toggleStep,
  };
}
