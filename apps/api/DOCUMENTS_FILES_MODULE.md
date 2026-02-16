# Documents & Files Module (MinIO Integration)

**Date**: Feb 16, 2026
**Status**: ✅ COMPLETE - Schema + Migration + Seed
**Version**: MVP

---

## Overview

The Documents & Files module allows tenants to store and manage building-related documents (rules, contracts, invoices, etc.) with flexible visibility controls and MinIO integration for file storage.

### Key Features
- 1:1 relationship between Document (metadata) and File (storage)
- Flexible document scoping: tenant-wide, building-wide, or unit-specific
- Document visibility control (admins only, residents, or private)
- MinIO integration ready (metadata captured: bucket, objectKey, checksum)
- Full audit trail (createdBy, createdAt, updatedAt)
- Multi-tenant isolation built-in

---

## Schema Models

### Enums

#### DocumentCategory
Available document types:
```typescript
enum DocumentCategory {
  RULES              // Reglamento/Normas
  MINUTES            // Actas de asambleas
  CONTRACT           // Contratos
  BUDGET             // Presupuestos
  INVOICE            // Facturas
  RECEIPT            // Recibos/Comprobantes
  OTHER              // Otro
}
```

#### DocumentVisibility
Access control levels:
```typescript
enum DocumentVisibility {
  TENANT_ADMINS      // Only TENANT_ADMIN, TENANT_OWNER, OPERATOR
  RESIDENTS          // RESIDENT + admins can view
  PRIVATE            // Only creator (createdByMembershipId) + SUPER_ADMIN
}
```

### Model 1: File (MinIO Metadata)

Stores file metadata for documents stored in MinIO.

```prisma
model File {
  id                      String    @id @default(cuid())
  tenantId                String    @fk(Tenant)

  // MinIO metadata
  bucket                  String    // Bucket name
  objectKey               String    // Full path in MinIO
  originalName            String    // For download
  mimeType                String    // "application/pdf"
  size                    Int       // Bytes
  checksum                String?   // SHA-256 or similar (optional)

  // Audit
  createdByMembershipId   String?   @fk(Membership)
  createdAt               DateTime  @default(now())

  // Relations
  tenant                  Tenant
  createdByMembership     Membership?
  document                Document?  // 1:1 back-reference

  // Indexes
  @@unique([tenantId, bucket, objectKey])
  @@index([tenantId, createdAt])
  @@index([tenantId, objectKey])
}
```

**Purpose**: Store file metadata without duplicating storage location across documents. Each file has exactly one document.

### Model 2: Document (Metadata + Visibility)

Stores document metadata with visibility control and flexible scoping.

```prisma
model Document {
  id                      String    @id @default(cuid())
  tenantId                String    @fk(Tenant)
  fileId                  String    @unique @fk(File)

  // Document metadata
  title                   String
  category                DocumentCategory
  visibility              DocumentVisibility @default(TENANT_ADMINS)

  // Scope: exactly ONE of these
  buildingId              String?   @fk(Building)  // Building-scoped
  unitId                  String?   @fk(Unit)      // Unit-scoped

  // Audit
  createdByMembershipId   String?   @fk(Membership)
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt

  // Relations
  tenant                  Tenant
  file                    File
  building                Building?
  unit                    Unit?
  createdByMembership     Membership?

  // Indexes
  @@index([tenantId, category])
  @@index([tenantId, buildingId])
  @@index([tenantId, unitId])
  @@index([tenantId, visibility])
}
```

**Purpose**: Metadata and access control for documents. Exactly 1:1 with File.

---

## Scope Rules

### CRITICAL RULE: Document Scope Constraint

A Document MUST be scoped to exactly ONE of:

**Option A: Building-Wide**
```
buildingId = "building-123"
unitId = NULL
```
Document applies to entire building.

**Option B: Unit-Specific**
```
buildingId = "building-123"  // Required: unit is part of building
unitId = "unit-456"
```
Document applies to specific unit (implies building scope as well).

**Option C: Tenant-Wide**
```
buildingId = NULL
unitId = NULL
```
Document applies to entire tenant.

### Validation Strategy

**Enforcement**: Must be done at **application layer**, not Prisma level.

```typescript
// Example validation in service layer
function validateDocumentScope(doc: Document) {
  const hasBuilding = doc.buildingId != null;
  const hasUnit = doc.unitId != null;

  // Rule: XOR of {hasBuilding, hasUnit, neither}
  if (hasUnit && !hasBuilding) {
    throw new Error('Unit-scoped document must also have buildingId');
  }

  // If has unitId, validate unit belongs to building
  if (hasUnit && hasBuilding) {
    const unit = await db.unit.findUnique({...});
    if (unit.buildingId !== doc.buildingId) {
      throw new Error('Unit does not belong to specified building');
    }
  }
}
```

---

## On Delete Strategy

### Decision: CASCADE

When a Document is deleted:
1. ✅ Document record is deleted
2. ✅ Linked File record is deleted (CASCADE)
3. 🔧 **APPLICATION LAYER**: Delete file from MinIO

When a File is deleted (without Document):
1. ⚠️ Orphaned File exists in database
2. 🔧 **CLEANUP JOB**: Periodic job to remove orphaned Files and their MinIO objects

### Rationale
- Document is the primary entity (metadata + visibility)
- File is storage metadata (should not exist without Document)
- MinIO cleanup handled separately (eventual consistency acceptable)
- Prevents orphaned files taking up storage space

---

## Database Schema

### File Table
```sql
CREATE TABLE "File" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL (FK Tenant),
  "bucket" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "checksum" TEXT,
  "createdByMembershipId" TEXT (FK Membership),
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE("tenantId", "bucket", "objectKey"),
  INDEX("tenantId", "createdAt"),
  INDEX("tenantId", "objectKey")
);
```

### Document Table
```sql
CREATE TABLE "Document" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL (FK Tenant),
  "fileId" TEXT NOT NULL UNIQUE (FK File) CASCADE,
  "title" TEXT NOT NULL,
  "category" DocumentCategory NOT NULL,
  "visibility" DocumentVisibility DEFAULT 'TENANT_ADMINS',
  "buildingId" TEXT (FK Building) CASCADE,
  "unitId" TEXT (FK Unit) CASCADE,
  "createdByMembershipId" TEXT (FK Membership),
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL,

  INDEX("tenantId", "category"),
  INDEX("tenantId", "buildingId"),
  INDEX("tenantId", "unitId"),
  INDEX("tenantId", "visibility")
);
```

---

## API Integration Pattern (Recommended)

### Create Document Workflow

```typescript
// 1. Upload file to MinIO (returns objectKey, size, checksum)
const fileMetadata = await minioClient.uploadFile({
  bucket: 'documents',
  objectKey: `tenant-${tenantId}/building-${buildingId}/rules.pdf`,
  file: uploadedFile,
});

// 2. Create File record in DB
const file = await db.file.create({
  data: {
    tenantId,
    bucket: 'documents',
    objectKey: fileMetadata.objectKey,
    originalName: uploadedFile.originalName,
    mimeType: uploadedFile.mimeType,
    size: fileMetadata.size,
    checksum: fileMetadata.sha256,
    createdByMembershipId: userMembershipId,
  },
});

// 3. Validate scope and create Document
validateDocumentScope({ buildingId, unitId });
const document = await db.document.create({
  data: {
    tenantId,
    fileId: file.id,
    title: 'Building Rules',
    category: 'RULES',
    visibility: 'RESIDENTS',
    buildingId,
    unitId: null,
    createdByMembershipId: userMembershipId,
  },
});
```

### Query Documents by Visibility

```typescript
// Get documents visible to user
async function getUserVisibleDocuments(
  tenantId: string,
  userId: string,
  buildingId?: string,
  unitId?: string,
) {
  const userRoles = await getUserRoles(userId, tenantId);
  const isAdmin = userRoles.some(r => ['TENANT_ADMIN', ...].includes(r));

  const query = {
    where: {
      tenantId,
      ...(buildingId && { buildingId }),
      ...(unitId && { unitId }),
    },
  };

  if (!isAdmin) {
    // Non-admins can only see RESIDENTS visibility
    query.where.visibility = 'RESIDENTS';
  }

  return db.document.findMany(query);
}
```

---

## Seed Data

The seed script includes 2 example documents:

### 1. Building Document (Building Rules)
```typescript
{
  id: "doc-building-rules-demo",
  tenantId: "Edificio Demo",
  fileId: "file-building-rules-demo",
  title: "Reglamento de Convivencia - Edificio Demo",
  category: DocumentCategory.RULES,
  visibility: DocumentVisibility.RESIDENTS,
  buildingId: "Demo Building",
  unitId: NULL,  // Building-scoped
  createdByMembershipId: "admin-membership-id",
  file: {
    bucket: "documents",
    objectKey: "tenant-xxx/building-yyy/rules.pdf",
    originalName: "Reglamento_Edificio_Demo.pdf",
    mimeType: "application/pdf",
    size: 245632,
  }
}
```

### 2. Unit Document (Maintenance Guide)
```typescript
{
  id: "doc-unit-demo",
  tenantId: "Edificio Demo",
  fileId: "file-unit-doc-demo",
  title: "Guía de Mantenimiento - Apt 101",
  category: DocumentCategory.OTHER,
  visibility: DocumentVisibility.TENANT_ADMINS,
  buildingId: "Demo Building",
  unitId: "Apt 101",  // Unit-scoped
  createdByMembershipId: "admin-membership-id",
  file: {
    bucket: "documents",
    objectKey: "tenant-xxx/unit-zzz/maintenance-guide.pdf",
    originalName: "Guia_Mantenimiento_Unidad.pdf",
    mimeType: "application/pdf",
    size: 102400,
  }
}
```

---

## Migration Details

**Migration ID**: `20260216152955_add_documents_and_files_module`

### Changes
1. ✅ Created `DocumentCategory` ENUM (7 values)
2. ✅ Created `DocumentVisibility` ENUM (3 values)
3. ✅ Created `File` table with 3 indexes
4. ✅ Created `Document` table with 4 indexes
5. ✅ Added foreign keys with CASCADE delete
6. ✅ Updated `Tenant`, `Building`, `Unit`, `Membership` relations

### Migration Status
```
✅ Applied successfully
✅ Database in sync
✅ Prisma Client regenerated
✅ Seed script updated
✅ Seed ran successfully
```

---

## Usage Examples

### List Building Documents

```typescript
const docs = await prisma.document.findMany({
  where: {
    tenantId: "tenant-1",
    buildingId: "building-1",
    visibility: { in: ['RESIDENTS', 'TENANT_ADMINS'] },
  },
  include: {
    file: true,
    createdByMembership: {
      include: { user: true },
    },
  },
});
```

### Get Document with File

```typescript
const doc = await prisma.document.findUnique({
  where: { id: "doc-123" },
  include: {
    file: true,
    building: true,
    unit: true,
    tenant: true,
  },
});

// Use doc.file for MinIO download
const downloadUrl = await minioClient.getDownloadUrl({
  bucket: doc.file.bucket,
  objectKey: doc.file.objectKey,
  originalName: doc.file.originalName,
});
```

### Delete Document (with MinIO cleanup)

```typescript
// 1. Get file metadata before delete
const doc = await prisma.document.findUnique({
  where: { id: "doc-123" },
  include: { file: true },
});

// 2. Delete document (File deleted via CASCADE)
await prisma.document.delete({
  where: { id: "doc-123" },
});

// 3. Delete from MinIO (separate transaction)
await minioClient.deleteObject({
  bucket: doc.file.bucket,
  objectKey: doc.file.objectKey,
});
```

---

## Acceptance Criteria

✅ **File model created**
- id, tenantId, bucket, objectKey, originalName, mimeType, size, checksum
- createdByMembershipId (nullable), createdAt
- Relations: Tenant, Membership, Document (1:1)
- Indexes: (tenantId, createdAt), (tenantId, objectKey), unique (tenantId, bucket, objectKey)

✅ **Document model created**
- id, tenantId, fileId (unique), title, category, visibility
- Scope: buildingId (nullable), unitId (nullable)
- createdByMembershipId (nullable), createdAt, updatedAt
- Relations: Tenant, File, Building, Unit, Membership
- Indexes: (tenantId, category), (tenantId, buildingId), (tenantId, unitId), (tenantId, visibility)

✅ **Enums created**
- DocumentCategory: RULES, MINUTES, CONTRACT, BUDGET, INVOICE, RECEIPT, OTHER
- DocumentVisibility: TENANT_ADMINS, RESIDENTS, PRIVATE

✅ **Migration applied successfully**
- Database schema updated
- Prisma Client regenerated
- No errors

✅ **Seed data created**
- 1 building-scoped document (rules) + file
- 1 unit-scoped document (guide) + file
- Both linked with 1:1 relationship

✅ **ON DELETE strategy documented**
- CASCADE Document→File (cleanup in app layer)
- Clear rationale and implementation guidance

---

## Next Steps

1. **Backend API** - Implement controllers/services
   - POST /tenants/:tenantId/documents (create)
   - GET /tenants/:tenantId/documents (list with filters)
   - GET /tenants/:tenantId/documents/:id (detail)
   - DELETE /tenants/:tenantId/documents/:id
   - POST /tenants/:tenantId/documents/:id/download

2. **MinIO Integration** - Implement upload/download/delete
   - Configure MinIO client
   - Implement upload streaming
   - Implement signed download URLs
   - Implement periodic cleanup job for orphaned files

3. **Frontend** - Implement UI
   - Document list page (with filters by category, building, unit)
   - Document upload form
   - Document detail modal
   - Download button with progress

4. **Security** - Add validation
   - Scope validation (app layer)
   - Visibility enforcement
   - File size limits
   - Allowed MIME types

---

## Notes

- **Validation**: Scope constraint must be validated in service layer
- **Cleanup**: MinIO file cleanup should be asynchronous (eventual consistency acceptable)
- **Visibility**: PRIVATE documents only visible to creator + SUPER_ADMIN
- **Audit**: createdByMembershipId nullable for system-generated docs
- **Performance**: Indexes on (tenantId, category), (tenantId, visibility) for efficient filtering

---

## Changelog

| Date | Change | Status |
|------|--------|--------|
| 2026-02-16 | Initial schema design + migration | ✅ Complete |
| 2026-02-16 | Seed data (2 documents) | ✅ Complete |
| TBD | Backend API implementation | ⏳ Pending |
| TBD | MinIO integration | ⏳ Pending |
| TBD | Frontend UI | ⏳ Pending |

---

**Status**: ✅ Module Complete (Schema + Migration + Seed)
