'use client';

import { t } from '@/i18n';
import type { CommunicationStatus } from '../services/communications.api';

interface StatusBadgeProps {
  status: CommunicationStatus;
}

/** Shared status badge for communications (DRAFT / SCHEDULED / SENT) */
export const StatusBadge = ({ status }: StatusBadgeProps) => {
  const labels: Record<CommunicationStatus, string> = {
    DRAFT: t('communications.admin.draftLabel'),
    SCHEDULED: t('communications.admin.scheduledLabel'),
    SENT: t('communications.admin.sentLabel'),
  };
  const colors: Record<CommunicationStatus, string> = {
    DRAFT: 'bg-yellow-100 text-yellow-700',
    SCHEDULED: 'bg-blue-100 text-blue-700',
    SENT: 'bg-green-100 text-green-700',
  };
  return (
    <span className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${colors[status]}`}>
      {labels[status]}
    </span>
  );
};
