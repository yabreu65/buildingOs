import { apiClient } from '@/shared/lib/http/client';

export type CronTriggerKey =
  | 'scheduled-communications'
  | 'overdue-charges'
  | 'expense-periods'
  | 'payment-reminders'
  | 'urgent-ticket-escalation'
  | 'recurring-expenses'
  | 'monthly-finance-summary';

export interface CronTriggerResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  durationMs: number;
}

export async function triggerAutomationCron<T = unknown>(
  tenantId: string,
  buildingId: string,
  triggerKey: CronTriggerKey,
): Promise<CronTriggerResponse<T>> {
  return apiClient<CronTriggerResponse<T>>({
    path: `/buildings/${buildingId}/automation/cron-triggers/${triggerKey}`,
    method: 'POST',
    headers: {
      'X-Tenant-Id': tenantId,
    },
  });
}
