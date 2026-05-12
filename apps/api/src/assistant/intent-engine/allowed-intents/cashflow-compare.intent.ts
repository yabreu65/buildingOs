import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

/**
 * Cashflow Compare Intent (Stub)
 *
 * TODO: Implement full query for cashflow comparisons
 *
 * This intent will compare cashflow between periods,
 * identify trends, and project future cash positions.
 */
export const cashflowCompareIntent: IntentDefinition = {
  name: 'cashflow_compare',
  requiredPermission: 'payments.review' as Permission,
  supportedFilters: ['period', 'minAmount', 'maxAmount', 'sortField', 'sortOrder', 'limit'],
  supportedResponseTypes: ['text', 'table', 'kpi', 'chart'],
  executor: async (_params): Promise<IntentExecutionResult> => {
    throw new BadRequestException('cashflow_compare intent: Not yet implemented');
  },
};
