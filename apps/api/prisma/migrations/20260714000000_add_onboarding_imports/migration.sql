-- Onboarding imports: job preview persistence and issue tracking

CREATE TYPE "ImportType" AS ENUM ('INITIAL_ONBOARDING');
CREATE TYPE "ImportJobStatus" AS ENUM ('READY', 'BLOCKED', 'FAILED', 'EXPIRED');
CREATE TYPE "ImportIssueSeverity" AS ENUM ('BLOCKER', 'WARNING', 'INFO');

ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_FILE_LOADED';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_PREVIEW_READY';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_PREVIEW_BLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_PREVIEW_FAILED';

CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ImportType" NOT NULL,
    "status" "ImportJobStatus" NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT 'v1',
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileMimeType" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "originalObjectKey" TEXT NOT NULL,
    "normalizedObjectKey" TEXT,
    "summary" JSONB,
    "counts" JSONB,
    "canConfirm" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "sheet" TEXT NOT NULL,
    "row" INTEGER,
    "column" TEXT,
    "code" TEXT NOT NULL,
    "severity" "ImportIssueSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "receivedValue" TEXT,
    "normalizedValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalEntityReference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalEntityReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportJob_tenantId_type_schemaVersion_fileHash_key"
  ON "ImportJob"("tenantId", "type", "schemaVersion", "fileHash");
CREATE INDEX "ImportJob_tenantId_status_idx"
  ON "ImportJob"("tenantId", "status");
CREATE INDEX "ImportJob_tenantId_expiresAt_idx"
  ON "ImportJob"("tenantId", "expiresAt");
CREATE INDEX "ImportJob_tenantId_createdAt_idx"
  ON "ImportJob"("tenantId", "createdAt");
CREATE INDEX "ImportJob_createdByMembershipId_idx"
  ON "ImportJob"("createdByMembershipId");

CREATE INDEX "ImportIssue_tenantId_importJobId_idx"
  ON "ImportIssue"("tenantId", "importJobId");
CREATE INDEX "ImportIssue_tenantId_severity_idx"
  ON "ImportIssue"("tenantId", "severity");
CREATE INDEX "ImportIssue_tenantId_sheet_idx"
  ON "ImportIssue"("tenantId", "sheet");
CREATE INDEX "ImportIssue_tenantId_code_idx"
  ON "ImportIssue"("tenantId", "code");

CREATE UNIQUE INDEX "ExternalEntityReference_tenantId_source_entityType_external_key"
  ON "ExternalEntityReference"("tenantId", "source", "entityType", "externalCode");
CREATE INDEX "ExternalEntityReference_tenantId_entityType_idx"
  ON "ExternalEntityReference"("tenantId", "entityType");
CREATE INDEX "ExternalEntityReference_tenantId_entityId_idx"
  ON "ExternalEntityReference"("tenantId", "entityId");

ALTER TABLE "ImportJob"
  ADD CONSTRAINT "ImportJob_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportJob"
  ADD CONSTRAINT "ImportJob_createdByMembershipId_fkey"
  FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ImportIssue"
  ADD CONSTRAINT "ImportIssue_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportIssue"
  ADD CONSTRAINT "ImportIssue_importJobId_fkey"
  FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalEntityReference"
  ADD CONSTRAINT "ExternalEntityReference_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
