export type HitlQueueStatusFilter = 'open' | 'in_progress' | 'resolved' | 'dismissed';

export type HitlActorContext = {
  userId: string;
  isSuperAdmin: boolean;
  tenantId?: string;
  roles: string[];
};

export type HitlListQuery = {
  status?: string;
  tenantId?: string;
  fallbackPath?: string;
  cursor?: string;
  limit?: number;
};

export type HitlAction =
  | 'handoff.assign'
  | 'handoff.resolve'
  | 'handoff.dismiss';
