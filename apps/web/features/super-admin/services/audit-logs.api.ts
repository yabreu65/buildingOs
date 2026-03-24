import { getToken } from '@/features/auth/session.storage';

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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function makeRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}/api${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
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
    return makeRequest(`/super-admin/audit-logs?skip=${skip}&take=${take}`, {
      method: 'GET',
    });
  },
};
