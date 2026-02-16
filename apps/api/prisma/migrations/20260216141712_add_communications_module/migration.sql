-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP', 'PUSH');

-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENT');

-- CreateEnum
CREATE TYPE "CommunicationTargetType" AS ENUM ('ALL_TENANT', 'BUILDING', 'UNIT', 'ROLE');

-- CreateTable
CREATE TABLE "Communication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "status" "CommunicationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByMembershipId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationTarget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "communicationId" TEXT NOT NULL,
    "targetType" "CommunicationTargetType" NOT NULL,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "communicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Communication_tenantId_status_idx" ON "Communication"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Communication_tenantId_buildingId_status_idx" ON "Communication"("tenantId", "buildingId", "status");

-- CreateIndex
CREATE INDEX "Communication_createdByMembershipId_idx" ON "Communication"("createdByMembershipId");

-- CreateIndex
CREATE INDEX "CommunicationTarget_communicationId_idx" ON "CommunicationTarget"("communicationId");

-- CreateIndex
CREATE INDEX "CommunicationTarget_tenantId_targetType_idx" ON "CommunicationTarget"("tenantId", "targetType");

-- CreateIndex
CREATE INDEX "CommunicationReceipt_tenantId_userId_readAt_idx" ON "CommunicationReceipt"("tenantId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "CommunicationReceipt_communicationId_readAt_idx" ON "CommunicationReceipt"("communicationId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationReceipt_communicationId_userId_key" ON "CommunicationReceipt"("communicationId", "userId");

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationTarget" ADD CONSTRAINT "CommunicationTarget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationTarget" ADD CONSTRAINT "CommunicationTarget_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "Communication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationReceipt" ADD CONSTRAINT "CommunicationReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationReceipt" ADD CONSTRAINT "CommunicationReceipt_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "Communication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationReceipt" ADD CONSTRAINT "CommunicationReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
