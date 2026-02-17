'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import type { Communication } from '../../services/communications.api';

interface CommunicationComposerModalProps {
  buildingId: string;
  tenantId: string;
  communication?: Communication;
  onSave: (input: any) => Promise<void>;
  onClose: () => void;
}

/**
 * CommunicationComposerModal: Create/edit communication draft
 */
export function CommunicationComposerModal({
  buildingId,
  communication,
  onSave,
  onClose,
}: CommunicationComposerModalProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState(communication?.title || '');
  const [body, setBody] = useState(communication?.body || '');
  const [channel, setChannel] = useState<'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP'>(
    (communication?.channel as any) || 'EMAIL'
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim() || !body.trim()) {
      toast('Title and body are required', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const input = {
        title: title.trim(),
        body: body.trim(),
        channel,
        targets: [{ targetType: 'BUILDING', targetId: buildingId }],
      };
      await onSave(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      toast(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50">
      <Card className="w-full md:w-2xl md:max-h-[90vh] md:rounded-lg rounded-t-lg overflow-auto">
        <div className="p-6 space-y-4">
          {/* Header */}
          <div>
            <h2 className="text-2xl font-bold">
              {communication ? 'Edit Communication' : 'New Communication'}
            </h2>
          </div>

          {/* Title Input */}
          <div>
            <label className="text-sm font-medium">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Communication title"
              className="w-full mt-1 px-3 py-2 border rounded-lg"
            />
          </div>

          {/* Body Textarea */}
          <div>
            <label className="text-sm font-medium">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Communication body"
              rows={8}
              className="w-full mt-1 px-3 py-2 border rounded-lg"
            />
          </div>

          {/* Channel Select */}
          <div>
            <label className="text-sm font-medium">Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as any)}
              className="w-full mt-1 px-3 py-2 border rounded-lg"
            >
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
              <option value="PUSH">Push Notification</option>
              <option value="IN_APP">In-App</option>
            </select>
          </div>

          {/* Target Info (MVP: always building-scoped) */}
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm">
              <span className="font-medium">Target:</span> All building tenants
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : communication ? 'Update Draft' : 'Save Draft'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
