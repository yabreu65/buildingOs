import { Permission } from '../../../rbac/permissions';
import { AssistantDebtCalculatorService } from '../../assistant-debt-calculator.service';
import { resolveTenantDebtSummary } from '../../tenant-debt.service';
import { IntentDefinition, IntentExecutionResult } from '../intent.types';

const debtCalculator = new AssistantDebtCalculatorService();

export const tenantDebtIntent: IntentDefinition = {
  name: 'tenant_debt',
  requiredPermission: 'payments.review' as Permission,
  supportedFilters: [],
  supportedResponseTypes: ['kpi', 'text'],
  executor: async (params): Promise<IntentExecutionResult> => {
    const { tenantId, prisma } = params;
    const summary = await resolveTenantDebtSummary(prisma, debtCalculator, tenantId);

    return {
      data: summary,
    };
  },
};
