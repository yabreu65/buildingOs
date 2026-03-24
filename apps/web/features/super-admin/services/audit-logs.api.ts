import { apiClient } from '@/shared/lib/http/client';

export interface AuditLog {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogsResponse {
  data: AuditLog[];
  total: number;
}

export const auditLogsApi = {
  /**
   * Fetches paginated audit logs for the platform.
   * Super admins can see all audit logs; tenant admins see only their tenant's logs.
   * Residents are denied access to audit logs.
   * @param skip - Number of records to skip for pagination (default: 0)
   * @param take - Number of records to fetch (default: 50, max: 100)
   * @returns Promise resolving to paginated response with audit logs array and total count
   */
  async listLogs(skip = 0, take = 50): Promise<AuditLogsResponse> {
    return apiClient<AuditLogsResponse>({
      path: `/super-admin/audit-logs?skip=${skip}&take=${take}`,
      method: 'GET',
    });
  },
};
