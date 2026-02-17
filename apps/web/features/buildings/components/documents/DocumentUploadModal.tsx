'use client';

import React, { useState, useRef } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { Upload, X, Loader } from 'lucide-react';
import {
  presignUpload,
  uploadFileToMinio,
  createDocument,
  DocumentCategory,
  DocumentVisibility,
  CreateDocumentInput,
} from '../../services/documents.api';

interface DocumentUploadModalProps {
  tenantId: string;
  buildingId: string;
  onSuccess: () => void;
  onClose: () => void;
}

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
  'text/csv',
];

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export function DocumentUploadModal({
  tenantId,
  buildingId,
  onSuccess,
  onClose,
}: DocumentUploadModalProps) {
  // Form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('OTHER');
  const [visibility, setVisibility] = useState<DocumentVisibility>('RESIDENTS');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<'select' | 'upload' | 'create'>('select');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();

  // Validate file
  const validateFile = (file: File): string | null => {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return `Tipo de archivo no permitido: ${file.type}`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `Archivo demasiado grande. Máximo: 100MB`;
    }
    return null;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const error = validateFile(file);
    if (error) {
      toast(error, 'error');
      return;
    }

    setSelectedFile(file);
    if (!title) {
      setTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !title) {
      toast('Completa todos los campos', 'error');
      return;
    }

    setUploading(true);
    setStep('upload');
    setProgress(0);

    try {
      // Step 1: Get presigned URL
      const presignResponse = await presignUpload(
        tenantId,
        selectedFile.name,
        selectedFile.type,
        selectedFile.size,
      );

      toast('URL de carga generada', 'success');

      // Step 2: Upload to MinIO
      await uploadFileToMinio(presignResponse.url, selectedFile, setProgress);

      toast('Archivo subido', 'success');
      setStep('create');

      // Step 3: Create Document record
      const input: CreateDocumentInput = {
        title,
        category,
        visibility,
        file: {
          bucket: presignResponse.bucket,
          objectKey: presignResponse.objectKey,
          originalName: selectedFile.name,
          mimeType: selectedFile.type,
          size: selectedFile.size,
        },
        buildingId,
      };

      await createDocument(tenantId, input);

      toast('Documento creado', 'success');
      onSuccess();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al subir documento';
      toast(message, 'error');
      setStep('select');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">Subir Documento</h2>
            <button
              onClick={onClose}
              disabled={uploading}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Step 1: Select File */}
          {step === 'select' && (
            <div className="space-y-4">
              {/* File Input */}
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-gray-400 transition"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="font-medium">Arrastra un archivo o haz clic</p>
                <p className="text-sm text-muted-foreground">Máximo 100MB</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileSelect}
                accept={ALLOWED_MIME_TYPES.join(',')}
              />

              {/* Selected File Info */}
              {selectedFile && (
                <div className="bg-blue-50 p-3 rounded border border-blue-200">
                  <p className="text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)}MB
                  </p>
                </div>
              )}

              {/* Title */}
              <div>
                <label className="text-sm font-medium">Título</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej: Reglamento de Convivencia"
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Category */}
              <div>
                <label className="text-sm font-medium">Categoría</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DocumentCategory)}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="RULES">Reglamento</option>
                  <option value="MINUTES">Actas</option>
                  <option value="CONTRACT">Contrato</option>
                  <option value="BUDGET">Presupuesto</option>
                  <option value="INVOICE">Factura</option>
                  <option value="RECEIPT">Recibo</option>
                  <option value="OTHER">Otro</option>
                </select>
              </div>

              {/* Visibility */}
              <div>
                <label className="text-sm font-medium">Acceso</label>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as DocumentVisibility)}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="TENANT_ADMINS">Solo Admins</option>
                  <option value="RESIDENTS">Residentes</option>
                  <option value="PRIVATE">Privado</option>
                </select>
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-4">
                <Button variant="secondary" onClick={onClose} className="flex-1">
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  onClick={handleUpload}
                  disabled={!selectedFile || !title || uploading}
                  className="flex-1"
                >
                  Subir
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Uploading */}
          {(step === 'upload' || step === 'create') && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 justify-center py-8">
                <Loader className="w-5 h-5 animate-spin text-blue-500" />
                <p className="text-sm font-medium">
                  {step === 'upload' ? `Subiendo... ${Math.round(progress)}%` : 'Procesando...'}
                </p>
              </div>

              {step === 'upload' && (
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-500 h-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}

              <p className="text-xs text-muted-foreground text-center">
                {step === 'upload'
                  ? 'Subiendo archivo a servidor...'
                  : 'Guardando información del documento...'}
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
