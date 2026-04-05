-- AlterEnum
-- This migration adds two values to an existing enum.
-- With PostgreSQL, this is the preferred way to alter an enum type.

ALTER TYPE "NotificationType" ADD VALUE 'CHARGE_PUBLISHED' BEFORE 'PAYMENT_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_REJECTED' AFTER 'PAYMENT_RECEIVED';
