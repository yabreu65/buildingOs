/**
 * Documents API Service
 * Calls backend endpoints for file upload and document CRUD
 *
 * 2-Step Upload Flow:
 * 1. POST /documents/presign → get uploadUrl + objectKey
 * 2. PUT uploadUrl (direct to MinIO) → upload file
 * 3. POST /documents → create Document record with file metadata
 */

import { getToken } from '@/features/auth/session.storage';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const isDev = process.env.NODE_ENV === 'development';

// ============================================
// Types
// ============================================

export type DocumentCategory = 'RULES' | 'MINUTES' | 'CONTRACT' | 'BUDGET' | 'INVOICE' | 'RECEIPT' | 'OTHER';
export type DocumentVisibility = 'TENANT_ADMINS' | 'RESIDENTS' | 'PRIVATE';

export interface DocumentFile {
  id: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  checksum?: string;
  createdAt: string;
}

export interface Document {
  id: string;
  tenantId: string;
  title: string;
  category: DocumentCategory;
  visibility: DocumentVisibility;
  buildingId?: string;
  unitId?: string;
  file: DocumentFile;
  createdByMembership?: {
    user: {
      id: string;
      name: string;
      email: string;
    };
  };
  createdAt: string;
  updatedAt: string;
}

export interface PresignResponse {
  url: string;
  bucket: string;
  objectKey: string;
  expiresAt: string;
}

export interface DownloadUrlResponse {
  url: string;
  expiresAt: string;
}

export interface CreateDocumentInput {
  title: string;
  category: DocumentCategory;
  visibility: DocumentVisibility;
  file: {
    bucket: string;
    objectKey: string;
    originalName: string;
    mimeType: string;
    size: number;
    checksum?: string;
  };
  buildingId?: string;
  unitId?: string;
}

export interface UpdateDocumentInput {
  title?: string;
  category?: DocumentCategory;
  visibility?: DocumentVisibility;
}

// ============================================
// Logging Helpers (Dev Only)
// ============================================

function logRequest(method: string, endpoint: string, body?: unknown) {
  if (!isDev) return;
  console.log(`[API] ${method} ${endpoint}`, body && JSON.stringify(body));
}

function logError(endpoint: string, status: number, message: string) {
  if (!isDev) return;
  console.error(`[API ERROR] ${endpoint} (${status})`, message);
}

// ============================================
// Headers Helpers
// ============================================

function validateTenantId(tenantId: string | undefined): asserts tenantId is string {
  if (!tenantId || tenantId.trim() === '') {
    throw new Error('[API] Missing tenantId - cannot make tenant-scoped API calls');
  }
}

function getHeaders(tenantId: string): HeadersInit {
  validateTenantId(tenantId);
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    'X-Tenant-Id': tenantId,
  };
}

// ============================================
// Presign Upload Endpoint
// ============================================

/**
 * Step 1: Generate presigned upload URL
 *
 * POST /documents/presign
 * body: { originalName, mimeType, size? }
 * response: { url, bucket, objectKey, expiresAt }
 */
export async function presignUpload(
  tenantId: string,
  originalName: string,
  mimeType: string,
  size?: number,
): Promise<PresignResponse> {
  const endpoint = '/documents/presign';
  const body = { originalName, mimeType, ...(size && { size }) };
  logRequest('POST', endpoint, body);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: getHeaders(tenantId),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = `Failed to presign upload: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  return response.json();
}

/**
 * Step 2: Upload file to MinIO using presigned URL
 *
 * PUT presignedUrl
 * body: File blob
 * response: 200 OK
 *
 * Called directly by client (not through API wrapper)
 * Must be called before createDocument()
 */
export async function uploadFileToMinio(
  presignedUrl: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const xhr = new XMLHttpRequest();

  return new Promise((resolve, reject) => {
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        const percentComplete = (event.loaded / event.total) * 100;
        onProgress(percentComplete);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed: Network error'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload cancelled'));
    });

    xhr.open('PUT', presignedUrl, true);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

// ============================================
// Document CRUD Endpoints
// ============================================

/**
 * Step 3: Create Document record after file upload
 *
 * POST /documents
 * body: CreateDocumentInput
 * response: Document
 */
export async function createDocument(
  tenantId: string,
  input: CreateDocumentInput,
): Promise<Document> {
  const endpoint = '/documents';
  logRequest('POST', endpoint, input);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: getHeaders(tenantId),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = `Failed to create document: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  return response.json();
}

/**
 * List documents with optional filters
 *
 * GET /documents?buildingId=&unitId=&category=&visibility=
 */
export async function listDocuments(
  tenantId: string,
  filters?: {
    buildingId?: string;
    unitId?: string;
    category?: DocumentCategory;
    visibility?: DocumentVisibility;
  },
): Promise<Document[]> {
  const params = new URLSearchParams();
  if (filters?.buildingId) params.append('buildingId', filters.buildingId);
  if (filters?.unitId) params.append('unitId', filters.unitId);
  if (filters?.category) params.append('category', filters.category);
  if (filters?.visibility) params.append('visibility', filters.visibility);

  const queryString = params.toString();
  const endpoint = `/documents${queryString ? '?' + queryString : ''}`;
  logRequest('GET', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getHeaders(tenantId),
  });

  if (!response.ok) {
    const message = `Failed to list documents: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  return response.json();
}

/**
 * Get single document
 *
 * GET /documents/:id
 */
export async function getDocument(
  tenantId: string,
  documentId: string,
): Promise<Document> {
  const endpoint = `/documents/${documentId}`;
  logRequest('GET', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getHeaders(tenantId),
  });

  if (!response.ok) {
    const message = `Failed to get document: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  return response.json();
}

/**
 * Update document metadata
 *
 * PATCH /documents/:id
 */
export async function updateDocument(
  tenantId: string,
  documentId: string,
  input: UpdateDocumentInput,
): Promise<Document> {
  const endpoint = `/documents/${documentId}`;
  logRequest('PATCH', endpoint, input);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'PATCH',
    headers: getHeaders(tenantId),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = `Failed to update document: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  return response.json();
}

/**
 * Delete document
 *
 * DELETE /documents/:id
 */
export async function deleteDocument(
  tenantId: string,
  documentId: string,
): Promise<void> {
  const endpoint = `/documents/${documentId}`;
  logRequest('DELETE', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'DELETE',
    headers: getHeaders(tenantId),
  });

  if (!response.ok) {
    const message = `Failed to delete document: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }
}

/**
 * Get presigned download URL
 *
 * GET /documents/:id/download
 * response: { url, expiresAt }
 */
export async function getDownloadUrl(
  tenantId: string,
  documentId: string,
): Promise<DownloadUrlResponse> {
  const endpoint = `/documents/${documentId}/download`;
  logRequest('GET', endpoint);

  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'GET',
    headers: getHeaders(tenantId),
  });

  if (!response.ok) {
    const message = `Failed to get download URL: ${response.statusText}`;
    logError(endpoint, response.status, message);
    throw new Error(message);
  }

  return response.json();
}
