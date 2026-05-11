import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AuthorizeService } from '../rbac/authorize.service';
import type { Permission } from '../rbac/permissions';
import type { AssistantQueryPlan } from './query-plan.types';

export interface AssistantPolicyParams {
  tenantId: string;
  userId: string;
  userRoles: string[];
  plan: AssistantQueryPlan;
  buildingId?: string;
  unitId?: string;
}

const OPERATIONAL_ROLES = new Set(['SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN', 'OPERATOR']);

@Injectable()
export class AssistantPolicyEnforcerService {
  private readonly logger = new Logger(AssistantPolicyEnforcerService.name);

  constructor(private readonly authorize: AuthorizeService) {}

  /**
   * Enforce assistant data-access policy before an allowlisted executor reads data.
   */
  async assertCanExecute(params: AssistantPolicyParams): Promise<void> {
    if (!params.userRoles.some((role) => OPERATIONAL_ROLES.has(role))) {
      throw new ForbiddenException('Assistant query is not allowed for this role');
    }

    const authorized = await this.authorizeScoped({
      userId: params.userId,
      tenantId: params.tenantId,
      permission: params.plan.requiredPermission,
      buildingId: params.buildingId,
      unitId: params.unitId,
    });

    if (!authorized) {
      throw new ForbiddenException('Assistant query is outside user scope');
    }
  }

  private async authorizeScoped(params: {
    userId: string;
    tenantId: string;
    permission: Permission;
    buildingId?: string;
    unitId?: string;
  }): Promise<boolean> {
    try {
      return await this.authorize.authorize(params);
    } catch (error) {
      this.logger.warn(`Assistant P1 policy check failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
