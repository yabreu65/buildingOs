-- Allow the same workbook to be previewed again after a validator change while preserving prior previews.
CREATE UNIQUE INDEX "ImportJob_tenantId_type_schemaVersion_previewVersion_fileHash_key"
  ON "ImportJob"("tenantId", "type", "schemaVersion", "previewVersion", "fileHash");

DROP INDEX "ImportJob_tenantId_type_schemaVersion_fileHash_key";
