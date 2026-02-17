'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import DeleteConfirmDialog from '@/shared/components/ui/DeleteConfirmDialog';
import { useToast } from '@/shared/components/ui/Toast';
import { CommunicationComposerModal } from './CommunicationComposerModal';
import { Eye, Mail, Trash2 } from 'lucide-react';
import type { Communication } from '../../services/communications.api';

interface CommunicationDetailProps {
  communication: Communication;
  isAdmin: boolean;
  onSave?: (input: any) => Promise<void>;
  onSend?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

/**
 * CommunicationDetail: View communication + stats + admin actions
 */
export function CommunicationDetail({
  communication,
  isAdmin,
  onSave,
  onSend,
  onDelete,
  onClose,
}: CommunicationDetailProps) {
  const { toast } = useToast();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const readCount = communication.receipts?.filter((r) => r.readAt).length || 0;
  const totalRecipients = communication.receipts?.length || 0;
  const readRate =
    totalRecipients > 0 ? Math.round((readCount / totalRecipients) * 100) : 0;

  const handleSend = async () => {
    if (!onSend) return;
    setIsSending(true);
    try {
      await onSend();
      toast('Communication published', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to publish';
      toast(message, 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete();
      toast('Communication deleted', 'success');
      setShowDeleteDialog(false);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete';
      toast(message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50">
      <Card className="w-full md:w-2xl md:max-h-[90vh] md:rounded-lg rounded-t-lg overflow-auto">
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold">{communication.title}</h2>
              <p className="text-sm text-muted-foreground mt-1">{communication.channel}</p>
            </div>
            <span
              className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${
                communication.status === 'DRAFT'
                  ? 'bg-yellow-100 text-yellow-700'
                  : communication.status === 'SCHEDULED'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-green-100 text-green-700'
              }`}
            >
              {communication.status}
            </span>
          </div>

          {/* Body */}
          <div className="bg-muted p-4 rounded-lg">
            <p className="whitespace-pre-wrap text-sm">{communication.body}</p>
          </div>

          {/* Metadata */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Created by {communication.createdBy?.name}</p>
            <p>
              Created {new Date(communication.createdAt).toLocaleString()}
            </p>
            {communication.sentAt && (
              <p>Sent {new Date(communication.sentAt).toLocaleString()}</p>
            )}
            {communication.scheduledAt && (
              <p>
                Scheduled {new Date(communication.scheduledAt).toLocaleString()}
              </p>
            )}
          </div>

          {/* Stats (only for SENT) */}
          {communication.status === 'SENT' && totalRecipients > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 bg-muted rounded-lg text-center">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-lg font-semibold">{totalRecipients}</p>
              </div>
              <div className="p-3 bg-muted rounded-lg text-center">
                <p className="text-xs text-muted-foreground">Read</p>
                <p className="text-lg font-semibold">{readCount}</p>
              </div>
              <div className="p-3 bg-muted rounded-lg text-center">
                <p className="text-xs text-muted-foreground">Rate</p>
                <p className="text-lg font-semibold">{readRate}%</p>
              </div>
            </div>
          )}

          {/* Recipients List (for SENT) */}
          {communication.status === 'SENT' && communication.receipts?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Recipients</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {communication.receipts.map((receipt) => (
                  <div
                    key={receipt.id}
                    className="flex items-center gap-2 p-2 text-xs bg-muted rounded"
                  >
                    {receipt.readAt ? (
                      <Eye className="w-4 h-4 text-green-600" />
                    ) : (
                      <Mail className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className="flex-1">
                      {receipt.readAt
                        ? `Read ${new Date(receipt.readAt).toLocaleString()}`
                        : receipt.deliveredAt
                        ? `Delivered ${new Date(receipt.deliveredAt).toLocaleString()}`
                        : `Created ${new Date(receipt.createdAt).toLocaleString()}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end border-t pt-4">
            <Button variant="secondary" onClick={onClose} disabled={isSending || isDeleting}>
              Close
            </Button>

            {/* Draft Actions */}
            {communication.status === 'DRAFT' && isAdmin && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setShowEditor(true)}
                  disabled={isSending}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={isSending || isDeleting}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
                <Button onClick={handleSend} disabled={isSending || isDeleting}>
                  {isSending ? 'Publishing...' : 'Publish Now'}
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        isOpen={showDeleteDialog}
        title="Delete Communication"
        description="This action cannot be undone. The draft will be permanently deleted."
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteDialog(false)}
        isLoading={isDeleting}
      />

      {/* Editor Modal */}
      {showEditor && (
        <CommunicationComposerModal
          buildingId={communication.buildingId}
          tenantId={communication.tenantId}
          communication={communication}
          onSave={onSave || (async () => {})}
          onClose={() => setShowEditor(false)}
        />
      )}
    </div>
  );
}
