-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'AI_ACTION_CLICKED';

-- AlterTable
ALTER TABLE "AiInteractionLog" ADD COLUMN "cacheHit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "modelSize" TEXT,
ADD COLUMN "page" TEXT;

-- CreateTable
CREATE TABLE "AiActionEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "interactionId" TEXT,
    "actionType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "buildingId" TEXT,
    "unitId" TEXT,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiActionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiActionEvent_tenantId_clickedAt_idx" ON "AiActionEvent"("tenantId", "clickedAt");

-- CreateIndex
CREATE INDEX "AiActionEvent_tenantId_actionType_idx" ON "AiActionEvent"("tenantId", "actionType");

-- CreateIndex
CREATE INDEX "AiActionEvent_interactionId_idx" ON "AiActionEvent"("interactionId");

-- CreateIndex
CREATE INDEX "AiInteractionLog_tenantId_page_createdAt_idx" ON "AiInteractionLog"("tenantId", "page", "createdAt");

-- AddForeignKey
ALTER TABLE "AiActionEvent" ADD CONSTRAINT "AiActionEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionEvent" ADD CONSTRAINT "AiActionEvent_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionEvent" ADD CONSTRAINT "AiActionEvent_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "AiInteractionLog"("id") ON DELETE SET NULL;
