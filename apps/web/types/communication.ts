/**
 * Communication domain types
 */
import { CommunicationChannel, CommunicationType } from './enums';
import type { TargetType } from '@/features/communications/services/communications.api';

export interface CommunicationTarget {
  targetType: TargetType;
  targetId?: string;
}

export interface CommunicationInput {
  title: string;
  body: string;
  channel: CommunicationChannel;
  type?: CommunicationType;
  targets: CommunicationTarget[];
  scheduledFor?: string;
  tags?: string[];
}

export interface CommunicationResponse {
  id: string;
  title: string;
  body: string;
  channel: CommunicationChannel;
  type?: CommunicationType;
  targets: CommunicationTarget[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface CommunicationDetailProps {
  communication?: CommunicationResponse | null;
  onClose?: () => void;
  onSave?: (input: CommunicationInput) => Promise<void>;
  isLoading?: boolean;
}

export interface CommunicationComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (input: CommunicationInput) => Promise<void>;
  isLoading?: boolean;
  initialValues?: Partial<CommunicationInput>;
}

export interface CommunicationsListProps {
  tenantId: string;
  buildingId?: string;
  onSelectCommunication?: (comm: CommunicationResponse) => void;
}
