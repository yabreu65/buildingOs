'use client';

import { useState } from 'react';
import { t } from '@/i18n';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { X } from 'lucide-react';
import type { Communication, CommunicationChannel, TargetType } from '../services/communications.api';
import type { CommunicationInput } from '@/types/communication';

interface TargetOption {
  targetType: TargetType;
  targetId?: string;
  label: string;
}

const TARGET_OPTIONS: readonly TargetOption[] = [
  { targetType: 'BUILDING', label: 'communications.admin.targetAllTenant' },
  { targetType: 'ROLE', targetId: 'RESIDENT', label: 'communications.admin.targetRoleResidents' },
  { targetType: 'ROLE', targetId: 'OWNER', label: 'communications.admin.targetRoleOwners' },
  { targetType: 'ROLE', targetId: 'OPERATOR', label: 'communications.admin.targetRoleOperators' },
];

function getTargetKey(opt: TargetOption) {
  return `${opt.targetType}:${opt.targetId ?? ''}`;
}

interface CommunicationComposerModalProps {
  buildingId: string;
  communication?: Communication;
  onSave: (input: CommunicationInput, commId?: string) => Promise<void>;
  onClose: () => void;
}

/**
 * CommunicationComposerModal: Create/edit communication draft
 * - Target selector (building, roles)
 * - Optional schedule datetime
 */
export const CommunicationComposerModal = ({
  buildingId,
  communication,
  onSave,
  onClose,
}: CommunicationComposerModalProps) => {
  const { toast } = useToast();

  const [title, setTitle] = useState(communication?.title ?? '');
  const [body, setBody] = useState(communication?.body ?? '');
  const [channel, setChannel] = useState<CommunicationChannel>(
    (communication?.channel as CommunicationChannel) ?? 'IN_APP'
  );

  // Default: first target option (BUILDING = todo el edificio)
  const [selectedTarget, setSelectedTarget] = useState<TargetOption>(
    TARGET_OPTIONS[0]!
  );

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) {
      toast(t('communications.admin.titleRequired'), 'error');
      return;
    }
    if (!body.trim()) {
      toast(t('communications.admin.messageRequired'), 'error');
      return;
    }

    setIsSaving(true);
    try {
      const targets: Array<{ targetType: TargetType; targetId?: string }> = [
        {
          targetType: selectedTarget.targetType,
          targetId: selectedTarget.targetType === 'BUILDING' ? buildingId : selectedTarget.targetId,
        },
      ];

      const input: CommunicationInput = {
        title: title.trim(),
        body: body.trim(),
        channel,
        targets,
      };
      await onSave(input, communication?.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('communications.error');
      toast(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <Card className="w-full md:max-w-2xl md:max-h-[90vh] md:rounded-lg rounded-t-2xl overflow-auto">
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">
              {communication
                ? t('communications.admin.updateDraft')
                : t('communications.admin.newButton')}
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-muted transition"
              disabled={isSaving}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Title */}
          <div>
            <label className="text-sm font-medium block mb-1">
              {t('communications.admin.titleLabel')}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('communications.admin.titlePlaceholder')}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          {/* Body */}
          <div>
            <label className="text-sm font-medium block mb-1">
              {t('communications.admin.messageLabel')}
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('communications.admin.messagePlaceholder')}
              rows={7}
              className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
            />
          </div>

          {/* Channel + Target row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Channel */}
            <div>
              <label className="text-sm font-medium block mb-1">
                {t('communications.admin.channelLabel')}
              </label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as CommunicationChannel)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="IN_APP">{t('communications.admin.channelInApp')}</option>
                <option value="EMAIL">{t('communications.admin.channelEmail')}</option>
                <option value="PUSH">{t('communications.admin.channelPush')}</option>
                <option value="WHATSAPP">{t('communications.admin.channelWhatsapp')}</option>
              </select>
            </div>

            {/* Target */}
            <div>
              <label className="text-sm font-medium block mb-1">
                {t('communications.admin.targetLabel')}
              </label>
              <select
                value={getTargetKey(selectedTarget)}
                onChange={(e) => {
                  const found = TARGET_OPTIONS.find(
                    (opt) => getTargetKey(opt) === e.target.value
                  );
                  if (found) setSelectedTarget(found);
                }}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                {TARGET_OPTIONS.map((opt) => (
                  <option key={getTargetKey(opt)} value={getTargetKey(opt)}>
                    {t(opt.label)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={onClose} disabled={isSaving}>
              {t('communications.admin.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving
                ? t('communications.admin.saving')
                : communication
                ? t('communications.admin.updateDraft')
                : t('communications.admin.saveDraft')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
