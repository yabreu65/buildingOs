-- AlterTable: createdByMembershipId nullable en el árbol de policies para
-- no bloquear el tenant delete lifecycle (mismo patrón que FundArchivedBy).
ALTER TABLE "IncomePolicy" ALTER COLUMN "createdByMembershipId" DROP NOT NULL;
ALTER TABLE "IncomePolicyVersion" ALTER COLUMN "createdByMembershipId" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "IncomePolicy" DROP CONSTRAINT "IncomePolicy_createdByMembershipId_fkey";

-- AlterTable
ALTER TABLE "IncomePolicy" ALTER COLUMN "createdByMembershipId" SET DEFAULT NULL;

-- AddForeignKey
ALTER TABLE "IncomePolicy" ADD CONSTRAINT "IncomePolicy_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "IncomePolicyVersion" DROP CONSTRAINT "IncomePolicyVersion_createdByMembershipId_fkey";

-- AlterTable
ALTER TABLE "IncomePolicyVersion" ALTER COLUMN "createdByMembershipId" SET DEFAULT NULL;

-- AddForeignKey
ALTER TABLE "IncomePolicyVersion" ADD CONSTRAINT "IncomePolicyVersion_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
