-- CreateTable
CREATE TABLE "UserContext" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "activeBuildingId" TEXT,
    "activeUnitId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserContext_membershipId_key" ON "UserContext"("membershipId");

-- CreateIndex
CREATE INDEX "UserContext_membershipId_idx" ON "UserContext"("membershipId");

-- CreateIndex
CREATE INDEX "UserContext_activeBuildingId_idx" ON "UserContext"("activeBuildingId");

-- CreateIndex
CREATE INDEX "UserContext_activeUnitId_idx" ON "UserContext"("activeUnitId");

-- AddForeignKey
ALTER TABLE "UserContext" ADD CONSTRAINT "UserContext_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserContext" ADD CONSTRAINT "UserContext_activeBuildingId_fkey" FOREIGN KEY ("activeBuildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserContext" ADD CONSTRAINT "UserContext_activeUnitId_fkey" FOREIGN KEY ("activeUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
