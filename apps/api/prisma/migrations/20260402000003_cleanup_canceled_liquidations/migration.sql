-- One-time cleanup: remove all CANCELED liquidations and their associated charges.
-- From now on, cancellation uses hard delete so CANCELED records never accumulate.

-- 1. Delete charges linked to CANCELED liquidations (to avoid FK violations)
DELETE FROM "Charge"
WHERE "liquidationId" IN (
  SELECT id FROM "Liquidation" WHERE status = 'CANCELED'
);

-- 2. Delete all CANCELED liquidations
DELETE FROM "Liquidation" WHERE status = 'CANCELED';
