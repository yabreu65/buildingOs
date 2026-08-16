-- FIN-06R: invariantes DB de las ecuaciones resumen FIN-06 (nullable-safe).
-- Legacy rows (todos los campos FIN-06 null) siguen permitidas.
-- Rows FIN-06 deben tener el set completo y reconciliado:
--   gross + adjustment = preIncome
--   preIncome - offset = net
--   net = totalAmountMinor
-- Cada campo >= 0 (Adjustment del repo es positivo).

ALTER TABLE "Liquidation" ADD CONSTRAINT "Liquidation_fin06_summary_non_negative"
CHECK (
  ("grossExpenseAmountMinor" IS NULL AND "adjustmentAmountMinor" IS NULL AND "preIncomeAmountMinor" IS NULL AND "incomeOffsetAmountMinor" IS NULL AND "netDistributableAmountMinor" IS NULL)
  OR
  (
    "grossExpenseAmountMinor" >= 0
    AND "adjustmentAmountMinor" >= 0
    AND "preIncomeAmountMinor" >= 0
    AND "incomeOffsetAmountMinor" >= 0
    AND "netDistributableAmountMinor" >= 0
    AND "grossExpenseAmountMinor" IS NOT NULL
    AND "adjustmentAmountMinor" IS NOT NULL
    AND "preIncomeAmountMinor" IS NOT NULL
    AND "incomeOffsetAmountMinor" IS NOT NULL
    AND "netDistributableAmountMinor" IS NOT NULL
    AND "grossExpenseAmountMinor" + "adjustmentAmountMinor" = "preIncomeAmountMinor"
    AND "preIncomeAmountMinor" - "incomeOffsetAmountMinor" = "netDistributableAmountMinor"
    AND "netDistributableAmountMinor" = "totalAmountMinor"
  )
);
