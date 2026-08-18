import type { IncomeApplication } from '../contracts';

/**
 * FIN-07BR: provenance de una IncomeApplication.
 *
 * Reglas fail-closed (espejo del CHECK DB de mutua exclusión):
 * - policyVersionId != null && legacyDestination == null => POLICY
 * - policyVersionId == null && legacyDestination != null => LEGACY
 * - policyVersionId == null && legacyDestination == null => MANUAL
 * - ambos != null => INVALID (datos malformados; no etiquetar en silencio)
 */
export type IncomeApplicationProvenanceOrigin =
  | 'MANUAL'
  | 'POLICY'
  | 'LEGACY'
  | 'INVALID';

export interface IncomeApplicationProvenance {
  readonly origin: IncomeApplicationProvenanceOrigin;
  readonly policyVersionId: string | null;
  readonly legacyDestination: IncomeApplication['legacyDestination'];
}

export function incomeApplicationProvenance(
  application: Pick<
    IncomeApplication,
    'policyVersionId' | 'legacyDestination'
  >,
): IncomeApplicationProvenance {
  const { policyVersionId, legacyDestination } = application;
  if (policyVersionId != null && legacyDestination != null) {
    return { origin: 'INVALID', policyVersionId, legacyDestination };
  }
  if (policyVersionId != null) {
    return { origin: 'POLICY', policyVersionId, legacyDestination: null };
  }
  if (legacyDestination != null) {
    return { origin: 'LEGACY', policyVersionId: null, legacyDestination };
  }
  return { origin: 'MANUAL', policyVersionId: null, legacyDestination: null };
}
