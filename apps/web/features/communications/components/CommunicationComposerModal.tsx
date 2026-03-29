'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { t } from '@/i18n';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { useBuildings } from '@/features/buildings/hooks';
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
  const params = useParams();
  const tenantId = params?.tenantId as string;
  const { buildings } = useBuildings(tenantId);

  const [title, setTitle] = useState(communication?.title ?? '');
  const [body, setBody] = useState(communication?.body ?? '');
  const [channel, setChannel] = useState<CommunicationChannel>(
    (communication?.channel as CommunicationChannel) ?? 'IN_APP'
  );

  // Default: first target option (BUILDING = todo el edificio)
  const [selectedTarget, setSelectedTarget] = useState<TargetOption>(
    TARGET_OPTIONS[0]!
  );

  // Building scope selector
  type BuildingScope = 'THIS' | 'MULTIPLE' | 'ALL';
  const [buildingScope, setBuildingScope] = useState<BuildingScope>('THIS');
  const [selectedBuildingIds, setSelectedBuildingIds] = useState<Set<string>>(
    new Set([buildingId])
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

    // Validar que haya edificios seleccionados si es MULTIPLE
    if (buildingScope === 'MULTIPLE' && selectedBuildingIds.size === 0) {
      toast('Selecciona al menos un edificio', 'error');
      return;
    }

    setIsSaving(true);
    try {
      let targets: Array<{ targetType: TargetType; targetId?: string }> = [];

      if (selectedTarget.targetType === 'ROLE') {
        // Si es por rol, usar el target actual
        targets = [
          {
            targetType: selectedTarget.targetType,
            targetId: selectedTarget.targetId,
          },
        ];
      } else if (selectedTarget.targetType === 'BUILDING') {
        // Si es por edificio, generar target por cada edificio seleccionado
        if (buildingScope === 'THIS') {
          targets = [{ targetType: 'BUILDING', targetId: buildingId }];
        } else if (buildingScope === 'MULTIPLE') {
          targets = Array.from(selectedBuildingIds).map((id) => ({
            targetType: 'BUILDING' as TargetType,
            targetId: id,
          }));
        } else if (buildingScope === 'ALL') {
          // Para todos los edificios, crear un target por cada edificio
          targets = buildings.map((b) => ({
            targetType: 'BUILDING' as TargetType,
            targetId: b.id,
          }));
        }
      }

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

  const handleBuildingToggle = (id: string) => {
    const newSet = new Set(selectedBuildingIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedBuildingIds(newSet);
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

          {/* Building Scope (only show if BUILDING target) */}
          {selectedTarget.targetType === 'BUILDING' && (
            <div className="border-t pt-4">
              <label className="text-sm font-medium block mb-3">Alcance del comunicado</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="buildingScope"
                    value="THIS"
                    checked={buildingScope === 'THIS'}
                    onChange={(e) => setBuildingScope(e.target.value as BuildingScope)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Este edificio solamente</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="buildingScope"
                    value="MULTIPLE"
                    checked={buildingScope === 'MULTIPLE'}
                    onChange={(e) => setBuildingScope(e.target.value as BuildingScope)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Edificios específicos</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="buildingScope"
                    value="ALL"
                    checked={buildingScope === 'ALL'}
                    onChange={(e) => setBuildingScope(e.target.value as BuildingScope)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Todos los edificios del condominio</span>
                </label>
              </div>

              {/* Checkboxes for MULTIPLE scope */}
              {buildingScope === 'MULTIPLE' && buildings.length > 0 && (
                <div className="mt-3 pl-6 space-y-2 bg-muted/50 p-3 rounded-lg">
                  {buildings.map((building) => (
                    <label key={building.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedBuildingIds.has(building.id)}
                        onChange={() => handleBuildingToggle(building.id)}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-sm">{building.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

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
                  if (found) {
                    setSelectedTarget(found);
                    // Reset building scope when target changes
                    if (found.targetType === 'BUILDING') {
                      setBuildingScope('THIS');
                      setSelectedBuildingIds(new Set([buildingId]));
                    }
                  }
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
