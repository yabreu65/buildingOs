export type OnboardingStepId = "properties" | "units" | "banking" | "payments" | "review";

export type StepStatus = "DONE" | "TODO";

export type OnboardingStep = {
  id: OnboardingStepId;
  label: string;
  description: string;
  path: string;
  status: StepStatus;
  condition?: boolean;
  // Si true, el usuario puede marcarlo como completado manualmente
  // aunque la lógica automática diga que no.
  isManualOverrideAllowed?: boolean;
};

export type ManualCompletionMap = Record<string, boolean>;

export type TenantOnboardingState = {
  tenantId: string;
  manualCompletions: ManualCompletionMap;
  lastUpdated: string;
};
