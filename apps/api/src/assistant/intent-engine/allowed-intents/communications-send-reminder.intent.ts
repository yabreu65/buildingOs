import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

/**
 * Communications Send Reminder Intent (Stub)
 *
 * TODO: Implement full query for sending reminder communications
 *
 * This intent will send payment reminders to residents,
 * with customizable templates and delivery tracking.
 */
export const communicationsSendReminderIntent: IntentDefinition = {
  name: 'communications_send_reminder',
  requiredPermission: 'communications.send' as Permission,
  supportedFilters: ['period', 'status', 'category'],
  supportedResponseTypes: ['text', 'action_list'],
  executor: async (_params): Promise<IntentExecutionResult> => {
    throw new BadRequestException('communications_send_reminder intent: Not yet implemented');
  },
};
