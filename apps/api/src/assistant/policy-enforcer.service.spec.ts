import { ForbiddenException } from '@nestjs/common';
import { AssistantPolicyEnforcerService } from './policy-enforcer.service';
import type { AssistantQueryPlan } from './query-plan.types';

const plan: AssistantQueryPlan = {
  intent: 'unit_debt',
  module: 'payments',
  scope: 'unit',
  requiredPermission: 'payments.review',
  executor: 'unit_debt',
  filters: { unitCode: '0101', buildingAlias: 'A' },
  confidence: 0.92,
  source: 'deterministic_rules',
};

describe('AssistantPolicyEnforcerService', () => {
  const authorize = { authorize: jest.fn() };
  let service: AssistantPolicyEnforcerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AssistantPolicyEnforcerService(authorize as never);
  });

  it('authorizes operational roles with scoped permission and resource IDs', async () => {
    authorize.authorize.mockResolvedValue(true);

    await expect(service.assertCanExecute({
      tenantId: 'tenant-1',
      userId: 'operator-1',
      userRoles: ['OPERATOR'],
      plan,
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).resolves.toBeUndefined();

    expect(authorize.authorize).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'operator-1',
      permission: 'payments.review',
      buildingId: 'building-1',
      unitId: 'unit-1',
    });
  });

  it('rejects residents before querying scoped RBAC for operational live-data', async () => {
    await expect(service.assertCanExecute({
      tenantId: 'tenant-1',
      userId: 'resident-1',
      userRoles: ['RESIDENT'],
      plan,
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(authorize.authorize).not.toHaveBeenCalled();
  });

  it('rejects valid roles when scoped RBAC denies the resource', async () => {
    authorize.authorize.mockResolvedValue(false);

    await expect(service.assertCanExecute({
      tenantId: 'tenant-1',
      userId: 'operator-1',
      userRoles: ['OPERATOR'],
      plan,
      buildingId: 'building-2',
      unitId: 'unit-2',
    })).rejects.toThrow('outside user scope');
  });
});
