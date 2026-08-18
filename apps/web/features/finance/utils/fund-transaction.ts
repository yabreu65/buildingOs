/**
 * FIN-07BR: reversibilidad de un FundTransaction en UI.
 *
 * Solo se ofrece "Revertir" cuando TODAS las invariantes cliente-conocidas
 * lo permiten:
 * - no es una reversión en sí misma (reversalOfTransactionId == null)
 * - no pertenece a una IncomeApplication (incomeApplicationId == null):
 *   esas transacciones solo se revierten vía voidIncome en backend.
 * - el original NO fue ya revertido (existe otra tx con
 *   reversalOfTransactionId === transaction.id).
 *
 * El caller debe exigir además fund.status === 'ACTIVE' (no lo derivo aquí
 * para mantener la función independiente del tipo Fund).
 */
export function isFundTransactionReversible(
  transaction: {
    readonly id: string;
    readonly incomeApplicationId: string | null;
    readonly reversalOfTransactionId: string | null;
  },
  allTransactions: readonly {
    readonly reversalOfTransactionId: string | null;
  }[],
): boolean {
  if (transaction.reversalOfTransactionId !== null) return false;
  if (transaction.incomeApplicationId !== null) return false;
  const alreadyReversed = allTransactions.some(
    (candidate) => candidate.reversalOfTransactionId === transaction.id,
  );
  return !alreadyReversed;
}
