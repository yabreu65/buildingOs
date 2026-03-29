export type CommunicationStatus = 'DRAFT' | 'PUBLISHED';

export type CommunicationScopeType = 'BUILDING' | 'MULTI_BUILDING' | 'TENANT_ALL';

export type CommunicationPriority = 'NORMAL' | 'URGENT';

export type DeliveryStatus = 'UNREAD' | 'READ';

export type CreateCommunicationRequest =
  | {
      title: string;
      body: string;
      status: CommunicationStatus;
      priority: CommunicationPriority;
      scopeType: 'BUILDING';
      buildingId: string;
    }
  | {
      title: string;
      body: string;
      status: CommunicationStatus;
      priority: CommunicationPriority;
      scopeType: 'MULTI_BUILDING';
      buildingIds: string[];
    }
  | {
      title: string;
      body: string;
      status: CommunicationStatus;
      priority: CommunicationPriority;
      scopeType: 'TENANT_ALL';
    };

export type PublishCommunicationRequest = {
  sendWebPush: boolean;
};

export type CommunicationResponse = {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  status: CommunicationStatus;
  priority: CommunicationPriority;
  scopeType: CommunicationScopeType;
  buildingIds?: string[];
  createdAt: string;
  publishedAt?: string;
};

export interface ResidentCommunicationListItem {
  id: string;
  title: string;
  body: string;
  priority: string;
  scopeType: string;
  buildingIds: string[];
  createdAt: Date;
  publishedAt: Date | null;
  deliveryStatus: 'UNREAD' | 'READ';
  readAt: Date | null;
}

export interface ResidentCommunicationListResponse {
  items: ResidentCommunicationListItem[];
  nextCursor?: string;
}
