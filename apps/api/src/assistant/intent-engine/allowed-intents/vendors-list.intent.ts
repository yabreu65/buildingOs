import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

/**
 * Vendors List Intent (Stub)
 *
 * TODO: Implement full query for vendor management
 *
 * This intent will list vendors, their payment history,
 * outstanding balances, and communication options.
 */
export const vendorsListIntent: IntentDefinition = {
  name: 'vendors_list',
  requiredPermission: 'payments.review' as Permission,
  supportedFilters: ['category', 'minAmount', 'maxAmount', 'sortField', 'sortOrder', 'limit'],
  supportedResponseTypes: ['text', 'table'],
  executor: async (_params): Promise<IntentExecutionResult> => {
    throw new BadRequestException('vendors_list intent: Not yet implemented');
  },
};
