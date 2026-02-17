'use client';

import { AlertTriangle } from 'lucide-react';
import Card from './Card';
import Button from './Button';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export default function DeleteConfirmDialog({
  isOpen,
  title,
  description,
  onConfirm,
  onCancel,
  isLoading = false,
}: DeleteConfirmDialogProps) {
  if (!isOpen) return null;

  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <div className="flex gap-3 mb-4">
          <AlertTriangle className="text-amber-600 flex-shrink-0" size={24} />
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-6">{description}</p>
        <div className="flex gap-3 justify-end">
          <Button
            onClick={onCancel}
            variant="secondary"
            size="sm"
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            size="sm"
          >
            {isLoading ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
