'use client';

import { useState } from 'react';
import { t } from '@/i18n';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import DeleteConfirmDialog from '@/shared/components/ui/DeleteConfirmDialog';
import { useToast } from '@/shared/components/ui/Toast';
import { CommunicationComposerModal } from './CommunicationComposerModal';
import { Eye, Mail, Trash2, X, Clock } from 'lucide-react';
import type { Communication } from '../services/communications.api';
import type { CommunicationInput } from '@/types/communication';
import { StatusBadge } from './StatusBadge';

type ReceiptFilter = 'all' | 'read' | 'unread';

interface CommunicationDetailProps {
  communication: Communication;
  isAdmin: boolean;
  onSave?: (input: CommunicationInput) => Promise<void>;
  onSend?: (scheduledAt?: Date) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

/**
 * CommunicationDetail: View communication details, stats, receipts + admin actions
 * Supports scheduling on publish
 */
export const CommunicationDetail = ({
  communication,
  isAdmin,
  onSave,
  onSend,
  onDelete,
  onClose,
}: CommunicationDetailProps) => {
  const { toast } = useToast();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [receiptFilter, setReceiptFilter] = useState<ReceiptFilter>('all');

  const receipts = communication.receipts ?? [];
  const readCount = receipts.filter((r) => r.readAt).length;
  const totalRecipients = receipts.length;
  const readRate = totalRecipients > 0 ? Math.round((readCount / totalRecipients) * 100) : 0;

  const filteredReceipts = receipts.filter((r) => {
    if (receiptFilter === 'read') return !!r.readAt;
    if (receiptFilter === 'unread') return !r.readAt;
    return true;
  });

  const handleSendNow = async () => {
    if (!onSend) return;
    setIsSending(true);
    try {
      await onSend();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('communications.error');
      toast(message, 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handleSchedule = async () => {
    if (!onSend || !scheduledAt) return;
    const date = new Date(scheduledAt);
    if (date <= new Date()) {
      toast(t('communications.admin.pastDateError'), 'error');
      return;
    }
    setIsSending(true);
    try {
      await onSend(date);
      setShowScheduler(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('communications.error');
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
      setShowDeleteDialog(false);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('communications.error');
      toast(message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <Card className="w-full md:max-w-2xl md:max-h-[90vh] md:rounded-lg rounded-t-2xl overflow-auto">
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 mr-3">
              <h2 className="text-xl font-bold leading-tight">{communication.title}</h2>
              <div className="flex items-center gap-2 mt-1">
                <StatusBadge status={communication.status} />
                <span className="text-xs text-muted-foreground">
                  {communication.channel === 'WHATSAPP' ? t('communications.admin.channelWhatsapp') :
                   communication.channel === 'PUSH' ? t('communications.admin.channelPush') :
                   t('communications.admin.channelInApp')}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-muted transition flex-shrink-0"
              disabled={isSending || isDeleting}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="bg-muted p-4 rounded-lg">
            <p className="whitespace-pre-wrap text-sm">{communication.body}</p>
          </div>

          {/* Metadata */}
          <div className="text-xs text-muted-foreground space-y-0.5">
            {communication.createdBy?.name && (
              <p>{t('communications.admin.createdBy')}: <span className="text-foreground">{communication.createdBy.name}</span></p>
            )}
            <p>{t('communications.admin.createdAt')}: {new Date(communication.createdAt).toLocaleString('es-AR')}</p>
            {communication.sentAt && (
              <p>{t('communications.admin.sentAtLabel')}: {new Date(communication.sentAt).toLocaleString('es-AR')}</p>
            )}
            {communication.scheduledAt && (
              <p>{t('communications.admin.scheduledAtLabel')}: {new Date(communication.scheduledAt).toLocaleString('es-AR')}</p>
            )}
          </div>

          {/* Stats (SENT only) */}
          {communication.status === 'SENT' && totalRecipients > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 bg-muted rounded-lg text-center">
                <p className="text-xs text-muted-foreground">{t('communications.admin.statsTotal')}</p>
                <p className="text-xl font-bold">{totalRecipients}</p>
              </div>
              <div className="p-3 bg-muted rounded-lg text-center">
                <p className="text-xs text-muted-foreground">{t('communications.admin.statsRead')}</p>
                <p className="text-xl font-bold">{readCount}</p>
              </div>
              <div className="p-3 bg-muted rounded-lg text-center">
                <p className="text-xs text-muted-foreground">{t('communications.admin.statsRate')}</p>
                <p className="text-xl font-bold">{readRate}%</p>
              </div>
            </div>
          )}

          {/* Recipients list */}
          {receipts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">{t('communications.admin.recipientsList')} ({receipts.length})</h3>
                {communication.status === 'SENT' && (
                  <div className="flex gap-1">
                    {(['all', 'read', 'unread'] as ReceiptFilter[]).map((f) => (
                      <button
                        key={f}
                        onClick={() => setReceiptFilter(f)}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition ${
                          receiptFilter === f
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {f === 'all'
                          ? t('communications.admin.filterAllReceipts')
                          : f === 'read'
                          ? t('communications.admin.filterRead')
                          : t('communications.admin.filterUnread')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {filteredReceipts.map((receipt) => (
                  <div
                    key={receipt.id}
                    className="flex items-center gap-2 p-2 text-xs bg-muted rounded"
                  >
                    {receipt.readAt ? (
                      <Eye className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                    ) : (
                      <Mail className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className="flex-1 font-medium truncate">
                      {receipt.user?.name ?? receipt.userId}
                    </span>
                    <span className="text-muted-foreground whitespace-nowrap">
                      {receipt.readAt
                        ? `${t('communications.admin.readAt')} ${new Date(receipt.readAt).toLocaleDateString('es-AR')}`
                        : receipt.deliveredAt
                        ? `${t('communications.admin.deliveredAt')} ${new Date(receipt.deliveredAt).toLocaleDateString('es-AR')}`
                        : t('communications.admin.notRead')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Schedule input (shown when isAdmin + DRAFT + showScheduler) */}
          {showScheduler && (
            <div className="p-3 bg-muted rounded-lg space-y-2">
              <label className="text-sm font-medium block">
                {t('communications.admin.scheduleLabel')}
              </label>
              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                  className="flex-1 px-3 py-2 border rounded-lg text-sm"
                />
                <Button size="sm" onClick={handleSchedule} disabled={!scheduledAt || isSending}>
                  {isSending ? t('communications.admin.publishing') : t('communications.admin.schedule')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setShowScheduler(false)} disabled={isSending}>
                  {t('communications.admin.cancel')}
                </Button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end border-t pt-4">
            <Button variant="secondary" onClick={onClose} disabled={isSending || isDeleting}>
              {t('communications.admin.close')}
            </Button>

            {communication.status === 'DRAFT' && isAdmin && !showScheduler && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowEditor(true)}
                  disabled={isSending}
                >
                  {t('communications.admin.edit')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={isSending || isDeleting}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowScheduler(true)}
                  disabled={isSending}
                >
                  <Clock className="w-4 h-4 mr-1" />
                  {t('communications.admin.schedule')}
                </Button>
                <Button onClick={handleSendNow} disabled={isSending || isDeleting}>
                  {isSending ? t('communications.admin.publishing') : t('communications.admin.publishNow')}
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        isOpen={showDeleteDialog}
        title={t('communications.admin.deleteTitle')}
        description={t('communications.admin.deleteDesc')}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteDialog(false)}
        isLoading={isDeleting}
      />

      {/* Editor Modal */}
      {showEditor && (
        <CommunicationComposerModal
          buildingId={communication.buildingId}
          communication={communication}
          onSave={onSave ?? (async () => {})}
          onClose={() => setShowEditor(false)}
        />
      )}
    </div>
  );
};
