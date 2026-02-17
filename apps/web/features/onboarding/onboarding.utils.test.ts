import { mergeStepStatus } from "./onboarding.utils";
import { OnboardingStep } from "./onboarding.types";

// Mock básico de pasos
const mockSteps: OnboardingStep[] = [
  {
    id: "properties",
    label: "Properties",
    description: "Desc",
    path: "/p",
    status: "TODO",
    isManualOverrideAllowed: false,
  },
  {
    id: "units",
    label: "Units",
    description: "Desc",
    path: "/u",
    status: "TODO",
    isManualOverrideAllowed: true, // Permite manual
  },
  {
    id: "review",
    label: "Review",
    description: "Desc",
    path: "/r",
    status: "TODO",
    isManualOverrideAllowed: true,
  },
];

describe("mergeStepStatus", () => {
  it("should mark as DONE if autoComputedStatus is true", () => {
    const autoStatus = { properties: true };
    const manual = {};
    const result = mergeStepStatus(mockSteps, autoStatus, manual);

    expect(result.find((s) => s.id === "properties")?.status).toBe("DONE");
    expect(result.find((s) => s.id === "units")?.status).toBe("TODO");
  });

  it("should mark as DONE if manual completion is true and override is allowed", () => {
    const autoStatus = { units: false };
    const manual = { units: true };
    const result = mergeStepStatus(mockSteps, autoStatus, manual);

    expect(result.find((s) => s.id === "units")?.status).toBe("DONE");
  });

  it("should NOT mark as DONE if manual completion is true but override is NOT allowed", () => {
    const autoStatus = { properties: false };
    const manual = { properties: true }; // properties has isManualOverrideAllowed: false
    const result = mergeStepStatus(mockSteps, autoStatus, manual);

    expect(result.find((s) => s.id === "properties")?.status).toBe("TODO");
  });

  it("should prioritize auto DONE over manual TODO (implicit)", () => {
    // Si auto es true, siempre es DONE, independientemente de manual (salvo que implementemos 'uncheck' manual)
    const autoStatus = { units: true };
    const manual = { units: false };
    const result = mergeStepStatus(mockSteps, autoStatus, manual);

    expect(result.find((s) => s.id === "units")?.status).toBe("DONE");
  });
});
