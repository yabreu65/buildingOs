# BuildingOS - Upload Security Policy

**Version**: 1.0
**Date**: February 18, 2026
**Status**: Production Ready

---

## Overview

Comprehensive security policy for file uploads in BuildingOS. All file uploads are scanned, validated, and stored securely in S3-compatible storage (MinIO, AWS S3, R2, etc.).

---

## 1. Allowed File Types

### By Module

**Documents Module:**
- MIME types: `application/pdf`, `image/jpeg`, `image/png`
- Extensions: `.pdf`, `.jpg`, `.jpeg`, `.png`
- Use cases: Building documents, unit photos, proof of occupancy

**Communication Attachments:**
- MIME types: `image/jpeg`, `image/png`, `application/pdf`
- Extensions: `.jpg`, `.jpeg`, `.png`, `.pdf`
- Use cases: Announcements with images/attachments

**Payments Proof:**
- MIME types: `application/pdf`, `image/jpeg`, `image/png`
- Extensions: `.pdf`, `.jpg`, `.jpeg`, `.png`
- Use cases: Payment receipts, proof of payment

**Profile Pictures (Optional Future):**
- MIME types: `image/jpeg`, `image/png`
- Extensions: `.jpg`, `.jpeg`, `.png`
- Max dimensions: 2000x2000px

### Blocklisted File Types

The following file types are **ALWAYS BLOCKED**:

```
Executables: .exe, .bat, .sh, .com, .pif, .scr
Scripting: .js, .vbs, .jar, .zip, .rar, .7z
System: .sys, .dll, .drv, .so
Documents: .docx*, .xlsx, .pptx (office files)
Archives: .tar, .gz, .bz2
Others: .iso, .dmg, .app
```

*Why:* Prevent code execution, zip bombs, and malware delivery.

---

## 2. Size Limits

| Module | Per-File Max | Per-Tenant/Month | Notes |
|--------|-------------|-----------------|-------|
| Documents | 10 MB | 100 GB (basic plan) | Enforced by UPLOAD_MAX_BYTES |
| Communications | 5 MB | 50 GB | Smaller for performance |
| Payments | 10 MB | 20 GB | Proof of payment |
| Profile Pictures | 2 MB | 1 GB | If enabled |

**Formula:**
```
- Development: 10 MB per file (no monthly limit)
- Staging: 10 MB per file (100 GB monthly)
- Production: Per plan entitlements (enforced by PlanEntitlementsService)
```

### Size Validation

```typescript
// In documents.service.ts or similar
const MAX_SIZE = parseInt(process.env.UPLOAD_MAX_BYTES || '10485760'); // 10MB
if (file.size > MAX_SIZE) {
  throw new BadRequestException(
    `File size exceeds limit of ${MAX_SIZE / 1024 / 1024}MB`
  );
}
```

---

## 3. Upload Validation Pipeline

```
1. Pre-Upload Validation
   ├─ File size check (max allowed)
   ├─ MIME type validation
   ├─ Extension check (whitelist)
   └─ Rate limiting (per user, per tenant)

2. Storage Upload
   ├─ Virus/malware scan (optional: ClamAV)
   ├─ Content verification
   └─ Metadata extraction

3. Post-Upload Verification
   ├─ File integrity check
   ├─ Size verification
   └─ Access control validation

4. Cleanup
   └─ Temp files deleted
```

### Implementation Example

```typescript
async uploadDocument(
  tenantId: string,
  userId: string,
  file: Express.Multer.File,
  documentType: string
): Promise<Document> {
  // 1. Validate file
  this.validateUpload(file, {
    maxSize: 10_485_760, // 10MB
    allowedMimes: ['application/pdf', 'image/jpeg', 'image/png'],
    allowedExtensions: ['.pdf', '.jpg', '.jpeg', '.png'],
  });

  // 2. Check plan limits
  const usage = await this.getStorageUsage(tenantId);
  const limit = await this.getPlanLimit(tenantId);
  if (usage.totalBytes + file.size > limit) {
    throw new BadRequestException('Storage limit exceeded');
  }

  // 3. Generate safe storage key
  const objectKey = `${tenantId}/documents/${cuid()}${this.getExtension(file)}`;
  // NEVER use user-supplied filename

  // 4. Upload to S3
  await this.s3Service.upload({
    key: objectKey,
    body: file.buffer,
    contentType: file.mimetype,
    // Metadata for access control
    metadata: {
      tenantId,
      userId,
      originalName: file.originalname,
      uploadedAt: new Date().toISOString(),
    },
  });

  // 5. Store metadata in database
  const document = await this.prisma.document.create({
    data: {
      tenantId,
      userId,
      objectKey,
      originalName: this.sanitizeFilename(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      documentType,
    },
  });

  return document;
}
```

---

## 4. Security Measures

### 4.1 Path Traversal Prevention

**NEVER use user-supplied filenames as object keys!**

```typescript
// ❌ BAD - allows path traversal
const objectKey = file.originalname; // "../../sensitive.pdf"

// ✅ GOOD - server-generated key
const objectKey = `${tenantId}/documents/${cuid()}${this.getExtension(file)}`;
```

### 4.2 MIME Type Validation

```typescript
private readonly ALLOWED_MIMES = new Map([
  ['documents', ['application/pdf', 'image/jpeg', 'image/png']],
  ['communications', ['image/jpeg', 'image/png', 'application/pdf']],
  ['payments', ['application/pdf', 'image/jpeg', 'image/png']],
]);

validateMimeType(module: string, mimeType: string): boolean {
  const allowed = this.ALLOWED_MIMES.get(module);
  if (!allowed) return false;

  // Check against whitelist (not blacklist)
  if (!allowed.includes(mimeType)) {
    throw new BadRequestException(`MIME type not allowed: ${mimeType}`);
  }

  return true;
}
```

### 4.3 Filename Sanitization

```typescript
private sanitizeFilename(filename: string): string {
  // Remove path separators
  let safe = filename.replace(/[\/\\]/g, '_');

  // Remove suspicious characters
  safe = safe.replace(/[<>:"|?*]/g, '_');

  // Limit length
  safe = safe.substring(0, 255);

  // Store only for display (not as object key!)
  return safe;
}
```

### 4.4 Multi-Tenant Isolation

```typescript
// CRITICAL: Verify user has access to resource
async downloadDocument(tenantId: string, documentId: string, userId: string) {
  const document = await this.prisma.document.findUnique({
    where: { id: documentId },
  });

  // Check exists
  if (!document) {
    throw new NotFoundException('Document not found');
  }

  // Check tenant isolation (don't leak existence!)
  if (document.tenantId !== tenantId) {
    throw new NotFoundException('Document not found');
  }

  // Check user access (same 404, never 403)
  const hasAccess = await this.checkAccess(tenantId, userId, document);
  if (!hasAccess) {
    throw new NotFoundException('Document not found');
  }

  // Generate presigned URL (short expiration)
  const url = await this.s3Service.getPresignedUrl(document.objectKey, {
    expiresIn: 300, // 5 minutes
  });

  return { url, expiresIn: 300 };
}
```

### 4.5 Presigned URLs

All downloads use presigned URLs with short expiration:

```typescript
// ✅ CORRECT - presigned URL, short expiration
const url = await s3.getSignedUrl('getObject', {
  Bucket: bucket,
  Key: objectKey,
  Expires: 300, // 5 minutes
});

// ❌ WRONG - direct access, long expiration
const url = `https://s3.amazonaws.com/${bucket}/${objectKey}`;
```

---

## 5. Virus & Malware Scanning (Optional)

For high-security deployments, integrate ClamAV:

```typescript
import NodeClam from 'clamscan';

async uploadWithScan(file: Express.Multer.File): Promise<void> {
  const clamscan = await new NodeClam().init({
    clamdscan: {
      host: process.env.CLAMAV_HOST,
      port: process.env.CLAMAV_PORT,
    },
  });

  const { isInfected, viruses } = await clamscan.scanBuffer(file.buffer);

  if (isInfected) {
    throw new BadRequestException(
      `File contains malware: ${viruses.join(', ')}`
    );
  }

  // Continue with upload
}
```

---

## 6. Rate Limiting for Uploads

```typescript
// In rate-limit.middleware.ts
private getLimitConfig(req: Request) {
  // Upload endpoints - moderate rate limit
  if (req.path.includes('/upload') && req.method === 'POST') {
    return { max: 50, windowMs: 60 * 60 * 1000 }; // 50 uploads/hour per IP
  }

  // ...other endpoints
}
```

---

## 7. Monitoring & Alerts

### Metrics to Track

```typescript
// In monitoring/dashboard
- Total uploads per tenant (identify large uploads)
- Failed upload attempts (security events)
- Storage usage vs plan limit (prevent overages)
- MIME type distribution (identify anomalies)
- Upload size distribution (identify large files)
```

### Example Alert Condition

```
IF uploads_failed_count > 10 IN LAST_1_HOUR
THEN notify_security_team("High upload failure rate for tenant: X")
```

---

## 8. Compliance & Legal

### GDPR

- ✅ User can request data: export all documents
- ✅ User can delete: purge all documents
- ✅ Audit trail: log who uploaded what when

### Data Retention

```
- Development: 7 days (auto-purge)
- Staging: 30 days (manual purge)
- Production: Per tenant contract (configurable)
```

---

## 9. Troubleshooting

### Error: "MIME type not allowed"

**Cause:** File MIME type not in whitelist

**Solution:**
```bash
# Check actual MIME type
file -b --mime-type document.pdf
# Expected: application/pdf

# If wrong, convert file or report to admin
```

### Error: "File size exceeds limit"

**Cause:** File > UPLOAD_MAX_BYTES

**Solution:**
```bash
# Check file size
ls -lh large_file.pdf

# Contact admin to increase limit or upgrade plan
```

### Error: "Storage limit exceeded"

**Cause:** Tenant storage quota exceeded

**Solution:**
```
1. Delete old documents
2. Contact admin to increase quota
3. Upgrade to higher plan
```

---

## 10. Checklist for Uploads

- [ ] File size validated before upload
- [ ] MIME type validated against whitelist
- [ ] Extension validated
- [ ] Rate limiting enforced per IP/user
- [ ] User has access to destination (tenant/building/unit)
- [ ] Object key generated server-side (user filename NOT used)
- [ ] Filename sanitized for display only
- [ ] File uploaded to correct bucket/path
- [ ] Metadata stored in database
- [ ] Presigned URL has short expiration (5-10 min)
- [ ] Access log recorded (audit trail)
- [ ] No direct S3 URLs exposed
- [ ] Virus scan passed (if enabled)
- [ ] Plan limits respected (if applicable)

---

## 11. S3/MinIO Configuration

### Development (MinIO local)

```bash
# MinIO console at http://localhost:9001
# Credentials: buildingos / buildingos123
# Bucket: buildingos-dev
# Policy: Private (no public access)
```

### Staging (AWS S3)

```
# Bucket: buildingos-staging
# Region: us-east-1
# Policy: Private, versioning enabled, encryption enabled
# Lifecycle: Purge old versions after 30 days
```

### Production (AWS S3)

```
# Bucket: buildingos-prod
# Region: us-east-1 (or multi-region)
# Policy: Private, versioning enabled, encryption enabled
# Lifecycle: Archive to Glacier after 90 days
# MFA Delete: Enabled
# CloudTrail: Logs all access
```

---

## 12. Future Improvements

- [ ] Image thumbnail generation (for performance)
- [ ] Virus scanning integration (ClamAV)
- [ ] Advanced metadata extraction (EXIF, compression)
- [ ] Compression for large files
- [ ] CDN integration for faster downloads
- [ ] Encryption at rest (even on S3)
- [ ] Watermarking for sensitive documents

---

**Last Updated:** February 18, 2026
**Next Review:** May 18, 2026
