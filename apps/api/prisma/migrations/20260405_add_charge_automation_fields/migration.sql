-- AlterTable: Add automation fields to Charge model
-- Used by Phase 3 cronjobs (overdue detection, payment reminders)

ALTER TABLE "Charge" ADD COLUMN "overdueSince" TIMESTAMP(3);
ALTER TABLE "Charge" ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- Add index for overdue detection query (find overdue charges that haven't been marked yet)
CREATE INDEX "Charge_overdueSince_dueDate_idx" ON "Charge"("overdueSince", "dueDate");
