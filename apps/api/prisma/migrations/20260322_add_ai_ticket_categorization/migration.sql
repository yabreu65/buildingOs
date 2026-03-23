-- CreateEnum for TicketCategory
CREATE TYPE "TicketCategory" AS ENUM ('MAINTENANCE', 'REPAIR', 'CLEANING', 'COMPLAINT', 'SAFETY', 'BILLING', 'OTHER');

-- AlterTable Ticket: Change category from String to TicketCategory enum and add AI fields
-- First, add the new columns with temporary defaults
ALTER TABLE "Ticket" ADD COLUMN "aiSuggestedCategory" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ticket" ADD COLUMN "aiCategorySuggestion" TEXT;

-- Convert category column type from String to TicketCategory
ALTER TABLE "Ticket"
ALTER COLUMN "category" TYPE "TicketCategory" USING
  CASE
    WHEN category IN ('MAINTENANCE', 'REPAIR', 'CLEANING', 'COMPLAINT', 'SAFETY', 'BILLING') THEN category::"TicketCategory"
    ELSE 'OTHER'::"TicketCategory"
  END;

-- Set default to OTHER if not already set
ALTER TABLE "Ticket" ALTER COLUMN "category" SET DEFAULT 'OTHER'::"TicketCategory";
