'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Document,
  DocumentCategory,
  DocumentVisibility,
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  CreateDocumentInput,
  UpdateDocumentInput,
} from '../services/documents.api';

interface UseDocumentsBuildingOptions {
  tenantId: string;
  buildingId: string;
  autoFetch?: boolean;
}

export function useDocumentsBuilding({
  tenantId,
  buildingId,
  autoFetch = true,
}: UseDocumentsBuildingOptions) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(!!buildingId && autoFetch);
  const [error, setError] = useState<string | null>(null);

  // Fetch documents
  const fetch = useCallback(async () => {
    if (!buildingId || !tenantId) {
      setDocuments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const docs = await listDocuments(tenantId, { buildingId });
      setDocuments(docs);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load documents';
      setError(message);
      console.error('[useDocumentsBuilding] Error:', message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, buildingId]);

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch) {
      fetch();
    }
  }, [autoFetch, fetch]);

  // Create document
  const create = useCallback(
    async (input: CreateDocumentInput) => {
      if (!tenantId) throw new Error('Missing tenantId');

      try {
        const newDoc = await createDocument(tenantId, input);
        setDocuments((prev) => [newDoc, ...prev]);
        return newDoc;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create document';
        setError(message);
        throw err;
      }
    },
    [tenantId],
  );

  // Update document
  const update = useCallback(
    async (documentId: string, input: UpdateDocumentInput) => {
      if (!tenantId) throw new Error('Missing tenantId');

      try {
        const updated = await updateDocument(tenantId, documentId, input);
        setDocuments((prev) =>
          prev.map((doc) => (doc.id === documentId ? updated : doc)),
        );
        return updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update document';
        setError(message);
        throw err;
      }
    },
    [tenantId],
  );

  // Delete document
  const remove = useCallback(
    async (documentId: string) => {
      if (!tenantId) throw new Error('Missing tenantId');

      try {
        await deleteDocument(tenantId, documentId);
        setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete document';
        setError(message);
        throw err;
      }
    },
    [tenantId],
  );

  // Filter documents
  const filter = useCallback(
    (category?: DocumentCategory, visibility?: DocumentVisibility) => {
      return documents.filter((doc) => {
        if (category && doc.category !== category) return false;
        if (visibility && doc.visibility !== visibility) return false;
        return true;
      });
    },
    [documents],
  );

  return {
    documents,
    loading,
    error,
    fetch,
    create,
    update,
    remove,
    filter,
    refetch: fetch,
  };
}
