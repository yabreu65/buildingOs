-- Add escalatedAt field to Ticket model for tracking ticket escalation events
ALTER TABLE "Ticket" ADD COLUMN "escalatedAt" TIMESTAMP(3);

-- Create index for efficient querying of unescalated urgent tickets
CREATE INDEX "Ticket_status_priority_escalatedAt_createdAt_idx" ON "Ticket"("status", "priority", "escalatedAt", "createdAt");
