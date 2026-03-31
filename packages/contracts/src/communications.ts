import { z } from 'zod';

export type CommunicationStatus = 'DRAFT' | 'PUBLISHED';

export type CommunicationScopeType = 'BUILDING' | 'MULTI_BUILDING' | 'TENANT_ALL';

export type CommunicationPriority = 'NORMAL' | 'URGENT';

export type DeliveryStatus = 'UNREAD' | 'READ';

export const CommunicationStatusEnum = z.enum(['DRAFT', 'PUBLISHED']);
export const CommunicationPriorityEnum = z.enum(['NORMAL', 'URGENT']);
export const CommunicationScopeTypeEnum = z.enum(['BUILDING', 'MULTI_BUILDING', 'TENANT_ALL']);

export const CreateCommunicationRequestSchema = z.discriminatedUnion('scopeType', [
  z.object({
    title: z.string().min(3),
    body: z.string().min(3),
    status: CommunicationStatusEnum,
    priority: CommunicationPriorityEnum.default('NORMAL'),
    scopeType: z.literal('BUILDING'),
    buildingId: z.string().min(1),
  }),
  z.object({
    title: z.string().min(3),
    body: z.string().min(3),
    status: CommunicationStatusEnum,
    priority: CommunicationPriorityEnum.default('NORMAL'),
    scopeType: z.literal('MULTI_BUILDING'),
    buildingIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    title: z.string().min(3),
    body: z.string().min(3),
    status: CommunicationStatusEnum,
    priority: CommunicationPriorityEnum.default('NORMAL'),
    scopeType: z.literal('TENANT_ALL'),
  }),
]);

export type CreateCommunicationRequest = z.infer<typeof CreateCommunicationRequestSchema>;

export const PublishCommunicationRequestSchema = z.object({
  sendWebPush: z.boolean(),
});

export type PublishCommunicationRequest = z.infer<typeof PublishCommunicationRequestSchema>;

export const ResidentCommunicationsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type ResidentCommunicationsQuery = z.infer<typeof ResidentCommunicationsQuerySchema>;

export const CommunicationResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string(),
  body: z.string(),
  status: CommunicationStatusEnum,
  priority: CommunicationPriorityEnum,
  scopeType: CommunicationScopeTypeEnum,
  buildingIds: z.array(z.string()).optional(),
  createdAt: z.string(),
  publishedAt: z.string().optional(),
});

export type CommunicationResponse = z.infer<typeof CommunicationResponseSchema>;

export const ResidentCommunicationListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  priority: CommunicationPriorityEnum,
  scopeType: CommunicationScopeTypeEnum,
  buildingIds: z.array(z.string()),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  deliveryStatus: z.enum(['UNREAD', 'READ']),
  readAt: z.string().nullable(),
});

export type ResidentCommunicationListItem = z.infer<typeof ResidentCommunicationListItemSchema>;

export const ResidentCommunicationListResponseSchema = z.object({
  items: z.array(ResidentCommunicationListItemSchema),
  nextCursor: z.string().optional(),
});

export type ResidentCommunicationListResponse = z.infer<typeof ResidentCommunicationListResponseSchema>;

export type CreateCommunicationRequestOld =
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
