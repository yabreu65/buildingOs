import { BadRequestException } from '@nestjs/common';
import { Permission } from '../../../rbac/permissions';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

/**
 * Expenses Summary Intent (Stub)
 *
 * TODO: Implement full query for expense summaries
 *
 * This intent will provide expense breakdown by category,
 * period comparisons, and budget tracking.
 */
export const expensesSummaryIntent: IntentDefinition = {
  name: 'expenses_summary',
  requiredPermission: 'payments.review' as Permission,
  supportedFilters: ['period', 'category', 'minAmount', 'maxAmount', 'sortField', 'sortOrder', 'limit'],
  supportedResponseTypes: ['text', 'table', 'kpi'],
  executor: async (_params): Promise<IntentExecutionResult> => {
    throw new BadRequestException('expenses_summary intent: Not yet implemented');
  },
};
