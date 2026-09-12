-- Phase 3D.1: nullable snapshot keeps historical liquidations compatible without backfill.
ALTER TABLE "Liquidation"
ADD COLUMN "distributionSnapshot" JSONB;
