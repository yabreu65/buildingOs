-- AlterEnum: Add PAYMENT_REMINDER and EXPENSE_PERIOD_CREATED to NotificationType
-- Phase 3 cronjobs use these types for payment reminders and expense period auto-creation

ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_REMINDER' AFTER 'PAYMENT_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'EXPENSE_PERIOD_CREATED' AFTER 'OCCUPANT_ASSIGNED';
